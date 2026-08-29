#!/usr/bin/env python3
"""
ComfyUI カスタムノード セキュリティスキャナー
================================================

custom_nodes フォルダ配下(または指定したノードのみ)を静的解析し、
危険な可能性のある処理・依存パッケージの脆弱性・既知の悪意あるノードとの
突合を行い、Markdownレポートを出力します。

使い方:
    # ComfyUI の custom_nodes フォルダ全体をスキャン
    python scan_custom_nodes.py --custom-nodes-dir /path/to/ComfyUI/custom_nodes

    # ワークフローJSONで使われているノードのみに絞ってスキャン
    python scan_custom_nodes.py --custom-nodes-dir /path/to/ComfyUI/custom_nodes --workflow workflow.json

    # pip-audit をスキップ(未インストール環境向け)
    python scan_custom_nodes.py --custom-nodes-dir /path/to/ComfyUI/custom_nodes --skip-pip-audit

出力:
    security_report.md  (デフォルト。 --output で変更可)

注意:
    - 静的解析のため、動的に組み立てられた文字列(難読化されたコード)は
      検出できない場合があります。あくまで一次スクリーニング用です。
    - ComfyUI-Manager のブラックリストはネットワーク経由で取得します。
      オフライン環境では --skip-blacklist を使ってください。
"""

import argparse
import ast
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

# ----------------------------------------------------------------------------
# 設定: 危険とみなす関数呼び出し・モジュール
# ----------------------------------------------------------------------------

# AST上で「関数呼び出し」として検出する危険な名前
DANGEROUS_CALLS = {
    "eval": "任意コード評価 (eval)",
    "exec": "任意コード実行 (exec)",
    "compile": "動的コードコンパイル (compile)",
    "os.system": "シェルコマンド実行 (os.system)",
    "os.popen": "シェルコマンド実行 (os.popen)",
    "subprocess.call": "サブプロセス実行 (subprocess.call)",
    "subprocess.run": "サブプロセス実行 (subprocess.run)",
    "subprocess.Popen": "サブプロセス実行 (subprocess.Popen)",
    "subprocess.check_call": "サブプロセス実行 (subprocess.check_call)",
    "subprocess.check_output": "サブプロセス実行 (subprocess.check_output)",
    "pickle.load": "pickle読み込み (任意コード実行の可能性)",
    "pickle.loads": "pickle読み込み (任意コード実行の可能性)",
    "torch.load": "torch.load (weights_only=False だとpickle経由で任意コード実行の恐れ)",
    "importlib.import_module": "動的モジュールインポート",
    "__import__": "動的インポート (__import__)",
    "shutil.rmtree": "ディレクトリ再帰削除 (誤爆・悪用に注意)",
    "socket.socket": "生ソケット通信",
}

# ネットワーク通信系(危険というより「要注目」として別枠で報告)
NETWORK_MODULES = {"requests", "urllib", "urllib.request", "http.client", "socket", "ftplib", "telnetlib"}

# ComfyUI-Manager が管理する既知の危険/非推奨ノードリスト (コミュニティ運用)
BLACKLIST_URLS = [
    "https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/security-check.json",
]


@dataclass
class Finding:
    file: str
    line: int
    kind: str
    detail: str
    snippet: str = ""


@dataclass
class NodeReport:
    name: str
    path: str
    findings: list = field(default_factory=list)
    network_hits: list = field(default_factory=list)
    requirements: list = field(default_factory=list)
    blacklisted: bool = False
    blacklist_reason: str = ""

    def risk_level(self) -> str:
        if self.blacklisted:
            return "危険 (ブラックリスト該当)"
        high = any(f.kind in ("eval", "exec", "os.system", "os.popen", "subprocess.call",
                               "subprocess.run", "subprocess.Popen", "subprocess.check_call",
                               "subprocess.check_output", "pickle.load", "pickle.loads",
                               "torch.load", "__import__") for f in self.findings)
        if high:
            return "中〜高 (要目視確認)"
        if self.findings or self.network_hits:
            return "低〜中 (念のため確認推奨)"
        return "低 (目立った兆候なし)"


def resolve_call_name(node: ast.Call) -> str:
    """ast.Call の func 部分から 'os.system' のようなドット区切り名を復元する"""
    parts = []
    cur = node.func
    while isinstance(cur, ast.Attribute):
        parts.append(cur.attr)
        cur = cur.value
    if isinstance(cur, ast.Name):
        parts.append(cur.id)
    return ".".join(reversed(parts))


def scan_python_file(path: Path) -> tuple[list, list]:
    """1つの .py ファイルをAST解析し、(危険呼び出しfindings, ネットワークhits) を返す"""
    findings, network_hits = [], []
    try:
        source = path.read_text(encoding="utf-8", errors="ignore")
        tree = ast.parse(source, filename=str(path))
    except (SyntaxError, UnicodeDecodeError, ValueError):
        return findings, network_hits

    lines = source.splitlines()

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            full_name = resolve_call_name(node)
            short_name = full_name.split(".")[-1]
            match_key = None
            if full_name in DANGEROUS_CALLS:
                match_key = full_name
            elif short_name in DANGEROUS_CALLS and short_name in ("eval", "exec", "compile", "__import__"):
                match_key = short_name
            if match_key:
                lineno = getattr(node, "lineno", 0)
                snippet = lines[lineno - 1].strip() if 0 < lineno <= len(lines) else ""
                findings.append(Finding(
                    file=str(path), line=lineno, kind=match_key,
                    detail=DANGEROUS_CALLS[match_key], snippet=snippet,
                ))
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            mod_names = []
            if isinstance(node, ast.Import):
                mod_names = [a.name for a in node.names]
            else:
                if node.module:
                    mod_names = [node.module]
            for m in mod_names:
                if m in NETWORK_MODULES or m.split(".")[0] in NETWORK_MODULES:
                    network_hits.append((str(path), getattr(node, "lineno", 0), m))

    return findings, network_hits


def discover_node_dirs(custom_nodes_dir: Path, only_names: set | None) -> list[Path]:
    dirs = []
    for entry in sorted(custom_nodes_dir.iterdir()):
        if not entry.is_dir():
            continue
        if entry.name.startswith("."):
            continue
        if only_names is not None and entry.name not in only_names:
            continue
        dirs.append(entry)
    return dirs


def extract_class_types_from_workflow(workflow_path: Path) -> set[str]:
    """ワークフローJSONから class_type を全て抽出する(参考情報として出力)"""
    data = json.loads(workflow_path.read_text(encoding="utf-8"))
    class_types = set()
    # API形式 / UI形式どちらもざっくり対応
    nodes_iter = []
    if isinstance(data, dict) and "nodes" in data and isinstance(data["nodes"], list):
        nodes_iter = data["nodes"]
        for n in nodes_iter:
            if isinstance(n, dict) and "type" in n:
                class_types.add(n["type"])
    else:
        for v in data.values() if isinstance(data, dict) else []:
            if isinstance(v, dict) and "class_type" in v:
                class_types.add(v["class_type"])
    return class_types


def collect_requirements(node_dir: Path) -> list[str]:
    reqs = []
    for req_file in node_dir.rglob("requirements*.txt"):
        try:
            for line in req_file.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    reqs.append(line)
        except OSError:
            pass
    return reqs


def run_pip_audit(all_requirements: list[str]) -> str:
    if not all_requirements:
        return "対象のrequirementsが見つかりませんでした。"
    fd, tmp_req_name = tempfile.mkstemp(prefix="combined_requirements_", suffix=".txt")
    tmp_req = Path(tmp_req_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("\n".join(sorted(set(all_requirements))))
        try:
            result = subprocess.run(
                [sys.executable, "-m", "pip_audit", "-r", str(tmp_req), "--desc"],
                capture_output=True, text=True, timeout=300,
            )
            output = result.stdout + "\n" + result.stderr
            return output.strip() or "脆弱性は検出されませんでした。"
        except FileNotFoundError:
            return "pip-audit が見つかりません。`pip install pip-audit` でインストールしてください。"
        except subprocess.TimeoutExpired:
            return "pip-audit がタイムアウトしました。"
    finally:
        tmp_req.unlink(missing_ok=True)


def fetch_blacklist() -> dict:
    """ComfyUI-Manager の既知リスクリストを取得(オフライン時は空を返す)"""
    for url in BLACKLIST_URLS:
        try:
            with urllib.request.urlopen(url, timeout=10) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception:
            continue
    return {}


def check_blacklist(node_dir: Path, blacklist: dict) -> tuple[bool, str]:
    if not blacklist:
        return False, ""
    name_lower = node_dir.name.lower()
    # security-check.json の実際のキー構造はリポジトリ側で変動しうるため、
    # 存在するキーをゆるく走査してマッチを試みる
    for section_key, section_val in blacklist.items():
        if isinstance(section_val, list):
            for item in section_val:
                item_str = json.dumps(item, ensure_ascii=False).lower() if isinstance(item, (dict, list)) else str(item).lower()
                if name_lower in item_str:
                    return True, f"{section_key} に一致"
    return False, ""


def main():
    parser = argparse.ArgumentParser(description="ComfyUI カスタムノード セキュリティスキャナー")
    parser.add_argument("--custom-nodes-dir", required=True, help="ComfyUI の custom_nodes ディレクトリパス")
    parser.add_argument("--workflow", help="ワークフローJSON(指定するとそこで使われるノードのみに絞り込みを試みます。フォルダ名との突合は手動確認が必要です)")
    parser.add_argument("--output", default="security_report.md", help="出力するMarkdownレポートのパス")
    parser.add_argument("--skip-pip-audit", action="store_true", help="pip-audit の実行をスキップ")
    parser.add_argument("--skip-blacklist", action="store_true", help="ComfyUI-Manager ブラックリスト取得をスキップ(オフライン環境向け)")
    args = parser.parse_args()

    custom_nodes_dir = Path(args.custom_nodes_dir).expanduser().resolve()
    if not custom_nodes_dir.is_dir():
        print(f"エラー: ディレクトリが見つかりません: {custom_nodes_dir}", file=sys.stderr)
        sys.exit(1)

    referenced_class_types = None
    if args.workflow:
        wf_path = Path(args.workflow).expanduser().resolve()
        try:
            referenced_class_types = extract_class_types_from_workflow(wf_path)
            print(f"[info] ワークフローから {len(referenced_class_types)} 個の class_type を抽出しました(参考情報)")
        except Exception as e:
            print(f"[warn] ワークフローJSONの解析に失敗しました: {e}", file=sys.stderr)

    node_dirs = discover_node_dirs(custom_nodes_dir, only_names=None)
    print(f"[info] {len(node_dirs)} 個のカスタムノードディレクトリを検出しました")

    blacklist = {} if args.skip_blacklist else fetch_blacklist()
    if not args.skip_blacklist and not blacklist:
        print("[warn] ブラックリストを取得できませんでした(ネットワーク未接続、または取得先仕様変更の可能性)")

    reports: list[NodeReport] = []
    all_requirements: list[str] = []

    for node_dir in node_dirs:
        report = NodeReport(name=node_dir.name, path=str(node_dir))
        for py_file in node_dir.rglob("*.py"):
            if "/.git/" in str(py_file):
                continue
            findings, network_hits = scan_python_file(py_file)
            report.findings.extend(findings)
            report.network_hits.extend(network_hits)
        report.requirements = collect_requirements(node_dir)
        all_requirements.extend(report.requirements)
        report.blacklisted, report.blacklist_reason = check_blacklist(node_dir, blacklist)
        reports.append(report)

    pip_audit_output = "スキップされました(--skip-pip-audit)" if args.skip_pip_audit else run_pip_audit(all_requirements)

    write_report(args.output, reports, pip_audit_output, referenced_class_types, custom_nodes_dir)
    print(f"[info] レポートを出力しました: {args.output}")


def write_report(output_path: str, reports: list[NodeReport], pip_audit_output: str,
                  referenced_class_types, custom_nodes_dir: Path):
    risk_order = {"危険 (ブラックリスト該当)": 0, "中〜高 (要目視確認)": 1, "低〜中 (念のため確認推奨)": 2, "低 (目立った兆候なし)": 3}
    reports_sorted = sorted(reports, key=lambda r: risk_order.get(r.risk_level(), 9))

    lines = []
    lines.append("# ComfyUI カスタムノード セキュリティレポート\n")
    lines.append(f"- スキャン対象: `{custom_nodes_dir}`")
    lines.append(f"- 検出ノード数: {len(reports)}\n")

    if referenced_class_types is not None:
        lines.append("## ワークフローから抽出した class_type (参考)")
        lines.append("フォルダ名と一致しない場合があるため、目視で対応関係を確認してください。\n")
        for ct in sorted(referenced_class_types):
            lines.append(f"- `{ct}`")
        lines.append("")

    lines.append("## サマリー\n")
    lines.append("| ノード | リスクレベル | 危険呼び出し件数 | ネットワーク通信 | requirements件数 |")
    lines.append("|---|---|---|---|---|")
    for r in reports_sorted:
        lines.append(f"| {r.name} | {r.risk_level()} | {len(r.findings)} | {len(r.network_hits)} | {len(r.requirements)} |")
    lines.append("")

    lines.append("## 詳細\n")
    for r in reports_sorted:
        lines.append(f"### {r.name}")
        lines.append(f"- パス: `{r.path}`")
        lines.append(f"- リスクレベル: **{r.risk_level()}**")
        if r.blacklisted:
            lines.append(f"- ⚠️ ComfyUI-Manager ブラックリストに一致: {r.blacklist_reason}")
        if r.findings:
            lines.append("\n**危険な可能性のある呼び出し:**\n")
            for f in r.findings:
                rel = f.file.replace(r.path, "").lstrip("/")
                lines.append(f"- `{rel}:{f.line}` — {f.detail}")
                if f.snippet:
                    lines.append(f"  ```python\n  {f.snippet}\n  ```")
        if r.network_hits:
            lines.append("\n**ネットワーク関連モジュールの使用:**\n")
            for path_, lineno, mod in r.network_hits:
                rel = path_.replace(r.path, "").lstrip("/")
                lines.append(f"- `{rel}:{lineno}` — `import {mod}`")
        if r.requirements:
            lines.append("\n**requirements:**")
            lines.append("```")
            lines.extend(r.requirements)
            lines.append("```")
        if not r.findings and not r.network_hits:
            lines.append("\n目立った兆候は検出されませんでした(静的解析の限界にご注意ください)。")
        lines.append("")

    lines.append("## pip-audit 結果(依存パッケージの既知脆弱性)\n")
    lines.append("```")
    lines.append(pip_audit_output)
    lines.append("```\n")

    lines.append("## 注意事項")
    lines.append("- これは静的解析による一次スクリーニングです。難読化されたコードや動的に組み立てられた文字列は検出できません。")
    lines.append("- 「危険な呼び出し」があるからといって即座に悪意があるとは限りません(正当な用途で使われることも多いです)。中身を目視確認してください。")
    lines.append("- ComfyUI-Managerのブラックリストは取得先の仕様変更やネットワーク状況により取得できないことがあります。")

    Path(output_path).write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
