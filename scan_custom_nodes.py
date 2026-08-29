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
    - pip-audit は依存関係を解決するため、requirements に書かれたパッケージの
      メタデータをPyPIから取得・ビルドすることがあります(その過程で
      パッケージ側のコードが動く可能性があります)。素性の分からないノードを
      調べるときは、コンテナ等の隔離環境で実行するか --skip-pip-audit を
      使ってください。本スクリプトは requirements 中の --index-url や
      URL/VCS 直接指定など、取得先を乗っ取れる行を pip-audit に渡す前に
      除外します(除外した行はレポートに列挙します)。
"""

import argparse
import ast
import json
import os
import re
import stat
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
    "os.execv": "プロセス置換実行 (os.execv)",
    "os.spawnv": "プロセス起動 (os.spawnv)",
    "subprocess.call": "サブプロセス実行 (subprocess.call)",
    "subprocess.run": "サブプロセス実行 (subprocess.run)",
    "subprocess.Popen": "サブプロセス実行 (subprocess.Popen)",
    "subprocess.check_call": "サブプロセス実行 (subprocess.check_call)",
    "subprocess.check_output": "サブプロセス実行 (subprocess.check_output)",
    "subprocess.getoutput": "サブプロセス実行 (subprocess.getoutput)",
    "pickle.load": "pickle読み込み (任意コード実行の可能性)",
    "pickle.loads": "pickle読み込み (任意コード実行の可能性)",
    "torch.load": "torch.load (weights_only=False だとpickle経由で任意コード実行の恐れ)",
    "importlib.import_module": "動的モジュールインポート",
    "__import__": "動的インポート (__import__)",
    "shutil.rmtree": "ディレクトリ再帰削除 (誤爆・悪用に注意)",
    "socket.socket": "生ソケット通信",
}

# リスクレベルを「中〜高」に引き上げる呼び出し
HIGH_RISK_CALLS = {
    "eval", "exec", "__import__",
    "os.system", "os.popen", "os.execv", "os.spawnv",
    "subprocess.call", "subprocess.run", "subprocess.Popen",
    "subprocess.check_call", "subprocess.check_output", "subprocess.getoutput",
    "pickle.load", "pickle.loads", "torch.load",
}

# 名前空間なしで呼ばれても危険とみなす組み込み関数
DANGEROUS_BUILTINS = {"eval", "exec", "compile", "__import__"}

# ネットワーク通信系(危険というより「要注目」として別枠で報告)
NETWORK_MODULES = {"requests", "urllib", "urllib.request", "http.client", "socket", "ftplib", "telnetlib"}

# ComfyUI-Manager が管理する既知の危険/非推奨ノードリスト (コミュニティ運用)
BLACKLIST_URLS = [
    "https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/security-check.json",
]

# 解析対象の上限(悪意あるノードによるメモリ枯渇を避けるため)
MAX_PY_FILE_BYTES = 5 * 1024 * 1024
MAX_BLACKLIST_BYTES = 8 * 1024 * 1024

# requirements.txt から pip-audit に渡してよい「素の依存指定」だけを許可するパターン。
# --index-url のようなオプション行や、URL/VCS の直接指定は取得先を乗っ取れるため通さない。
SAFE_REQUIREMENT_RE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._-]*"                              # パッケージ名
    r"(\[[A-Za-z0-9,._-]+\])?"                                  # extras
    r"(\s*(==|!=|<=|>=|~=|===|<|>)\s*[A-Za-z0-9*.+!_-]+"        # バージョン指定
    r"(\s*,\s*(==|!=|<=|>=|~=|===|<|>)\s*[A-Za-z0-9*.+!_-]+)*)?"
    r"(\s*;[^\r\n]*)?$"                                         # 環境マーカー
)


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
    rejected_requirements: list = field(default_factory=list)
    blacklisted: bool = False
    blacklist_reason: str = ""

    def risk_level(self) -> str:
        if self.blacklisted:
            return "危険 (ブラックリスト該当)"
        if any(f.kind in HIGH_RISK_CALLS for f in self.findings):
            return "中〜高 (要目視確認)"
        if self.findings or self.network_hits or self.rejected_requirements:
            return "低〜中 (念のため確認推奨)"
        return "低 (目立った兆候なし)"


# ----------------------------------------------------------------------------
# Markdown 出力の無害化
#
# ノード名・ファイルパス・ソース断片・requirements はすべて「調査対象」つまり
# 信頼できない入力である。そのままレポートに埋め込むと、コードフェンスを閉じて
# HTMLコメントを開くなどして、後続の検出結果を隠すレポート改ざんができてしまう。
# ----------------------------------------------------------------------------

def _strip_control(text, keep_newlines: bool = False) -> str:
    """制御文字を落とす(改行はテーブル・見出しを壊すので既定で除去)"""
    s = str(text)
    if keep_newlines:
        s = s.replace("\r\n", "\n").replace("\r", "\n")
        return "".join(c for c in s if c == "\n" or (c >= " " and c != "\x7f"))
    s = s.replace("\r", " ").replace("\n", " ")
    return "".join(c for c in s if c >= " " and c != "\x7f")


def _longest_backtick_run(text: str) -> int:
    longest = current = 0
    for ch in text:
        current = current + 1 if ch == "`" else 0
        longest = max(longest, current)
    return longest


def md_text(text) -> str:
    """見出し・表のセルなどに地の文として埋め込む"""
    s = _strip_control(text)
    for ch in ("\\", "|", "`", "<", ">", "*", "_", "[", "]"):
        s = s.replace(ch, "\\" + ch)
    return s


def md_code_span(text) -> str:
    """インラインコードとして埋め込む(内部のバックティックで閉じられないようにする)"""
    s = _strip_control(text)
    delim = "`" * (_longest_backtick_run(s) + 1)
    pad = " " if s.startswith("`") or s.endswith("`") else ""
    return f"{delim}{pad}{s}{pad}{delim}"


def md_code_block(text, lang: str = "") -> list:
    """コードブロックとして埋め込む(内部のバックティックより長いフェンスを使う)"""
    s = _strip_control(text, keep_newlines=True)
    fence = "`" * max(3, _longest_backtick_run(s) + 1)
    return [fence + lang, s, fence]


# ----------------------------------------------------------------------------
# 静的解析
# ----------------------------------------------------------------------------

def build_import_bindings(tree: ast.AST) -> dict:
    """ファイル内のimportを辿り、ローカル名 -> 完全修飾名 の対応表を作る。

    `from os import system` や `import os as o` のような書き方でも
    os.system として解決できるようにするためのもの。
    """
    bindings = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.asname:
                    bindings[alias.asname] = alias.name
                else:
                    top = alias.name.split(".")[0]
                    bindings[top] = top
        elif isinstance(node, ast.ImportFrom):
            if node.level or not node.module:
                continue  # 相対importは解決対象外
            for alias in node.names:
                if alias.name == "*":
                    continue
                bindings[alias.asname or alias.name] = f"{node.module}.{alias.name}"
    return bindings


def resolve_call_name(node: ast.Call, bindings: dict) -> str:
    """ast.Call の func 部分から 'os.system' のようなドット区切り名を復元する。

    先頭の名前は import の対応表を通して完全修飾名に展開する。
    """
    parts = []
    cur = node.func
    while isinstance(cur, ast.Attribute):
        parts.append(cur.attr)
        cur = cur.value
    if not isinstance(cur, ast.Name):
        return ""
    parts.append(cur.id)
    parts.reverse()
    head = parts[0]
    if head in bindings:
        parts = bindings[head].split(".") + parts[1:]
    return ".".join(parts)


def scan_python_file(path: Path) -> tuple[list, list]:
    """1つの .py ファイルをAST解析し、(危険呼び出しfindings, ネットワークhits) を返す"""
    findings, network_hits = [], []
    try:
        source = path.read_text(encoding="utf-8", errors="ignore")
        tree = ast.parse(source, filename=str(path))
    except (SyntaxError, UnicodeDecodeError, ValueError, OSError, RecursionError, MemoryError):
        # 解析できないファイル1つでスキャン全体を止めない
        return findings, network_hits

    lines = source.splitlines()
    bindings = build_import_bindings(tree)

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            full_name = resolve_call_name(node, bindings)
            match_key = None
            if full_name in DANGEROUS_CALLS:
                match_key = full_name
            elif full_name in DANGEROUS_BUILTINS:
                match_key = full_name
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


def iter_python_files(node_dir: Path):
    """ノード配下の .py を列挙する。

    rglob はシンボリックリンクのディレクトリを辿らないが、ファイル単体の
    シンボリックリンクは返ってくる。ノード外を指すリンク(無関係なファイルの
    中身がレポートに載ってしまう)、FIFO やデバイス(readでブロックしうる)、
    壊れたリンク(読み込み時に例外)、極端に大きいファイルはここで除外する。
    """
    try:
        node_root = node_dir.resolve()
    except OSError:
        return
    for py_file in node_dir.rglob("*.py"):
        if ".git" in py_file.parts:
            continue
        try:
            if py_file.is_symlink() and not py_file.resolve(strict=True).is_relative_to(node_root):
                continue
            st = py_file.stat()  # リンク先を辿る
            if not stat.S_ISREG(st.st_mode) or st.st_size > MAX_PY_FILE_BYTES:
                continue
        except OSError:
            continue
        yield py_file


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
    if isinstance(data, dict) and isinstance(data.get("nodes"), list):
        for n in data["nodes"]:
            if isinstance(n, dict) and isinstance(n.get("type"), str):
                class_types.add(n["type"])
    else:
        for v in data.values() if isinstance(data, dict) else []:
            if isinstance(v, dict) and isinstance(v.get("class_type"), str):
                class_types.add(v["class_type"])
    return class_types


def collect_requirements(node_dir: Path) -> tuple[list, list]:
    """requirements*.txt を読み、(pip-auditに渡してよい行, 除外した行) を返す。

    除外するのは --index-url / --find-links のようなオプション行と、
    URL・VCS・ローカルパスの直接指定。これらは pip の取得先そのものを
    差し替えられるため、調査対象のノードに書かれた内容をそのまま
    pip-audit に渡すのは危険。
    """
    safe, rejected = [], []
    for req_file in node_dir.rglob("requirements*.txt"):
        try:
            if ".git" in req_file.parts or not req_file.is_file():
                continue
            if req_file.stat().st_size > MAX_PY_FILE_BYTES:
                continue
            content = req_file.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for raw in content.splitlines():
            line = _strip_control(raw).strip()
            if not line or line.startswith("#"):
                continue
            line = line.split(" #", 1)[0].strip()
            if SAFE_REQUIREMENT_RE.match(line):
                safe.append(line)
            else:
                rejected.append((str(req_file), line))
    return safe, rejected


def run_pip_audit(all_requirements: list) -> str:
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
        if not url.startswith("https://"):
            continue
        try:
            with urllib.request.urlopen(url, timeout=10) as resp:
                body = resp.read(MAX_BLACKLIST_BYTES + 1)
            if len(body) > MAX_BLACKLIST_BYTES:
                continue
            return json.loads(body.decode("utf-8"))
        except Exception:
            continue
    return {}


def _iter_strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _iter_strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _iter_strings(v)


def _candidate_names(text: str) -> set:
    """ブラックリスト中の文字列から、フォルダ名と比較しうる名前を取り出す"""
    s = text.strip().rstrip("/")
    names = {s.lower()}
    if "/" in s:
        tail = s.rsplit("/", 1)[-1].lower()
        names.add(tail)
        if tail.endswith(".git"):
            names.add(tail[:-4])
    return names


def check_blacklist(node_dir: Path, blacklist: dict) -> tuple[bool, str]:
    """フォルダ名をブラックリストと突合する。

    以前は部分一致で見ていたが、それだと短いフォルダ名がほぼ全件に当たって
    しまうため、リポジトリ名(URLの末尾)との完全一致で判定する。
    フォルダ名を変えて clone された場合は当たらないので、あくまで補助。
    """
    if not blacklist:
        return False, ""
    name_lower = node_dir.name.lower()
    for section_key, section_val in blacklist.items():
        for text in _iter_strings(section_val):
            if name_lower in _candidate_names(text):
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
    all_requirements: list = []

    for node_dir in node_dirs:
        report = NodeReport(name=node_dir.name, path=str(node_dir))
        for py_file in iter_python_files(node_dir):
            findings, network_hits = scan_python_file(py_file)
            report.findings.extend(findings)
            report.network_hits.extend(network_hits)
        report.requirements, report.rejected_requirements = collect_requirements(node_dir)
        all_requirements.extend(report.requirements)
        report.blacklisted, report.blacklist_reason = check_blacklist(node_dir, blacklist)
        reports.append(report)

    rejected_total = sum(len(r.rejected_requirements) for r in reports)
    if rejected_total:
        print(f"[warn] pip-audit に渡さなかった requirements 行が {rejected_total} 件あります(レポート参照)")

    pip_audit_output = "スキップされました(--skip-pip-audit)" if args.skip_pip_audit else run_pip_audit(all_requirements)

    write_report(args.output, reports, pip_audit_output, referenced_class_types, custom_nodes_dir)
    print(f"[info] レポートを出力しました: {args.output}")


def write_report(output_path: str, reports: list, pip_audit_output: str,
                  referenced_class_types, custom_nodes_dir: Path):
    risk_order = {"危険 (ブラックリスト該当)": 0, "中〜高 (要目視確認)": 1, "低〜中 (念のため確認推奨)": 2, "低 (目立った兆候なし)": 3}
    reports_sorted = sorted(reports, key=lambda r: (risk_order.get(r.risk_level(), 9), r.name))

    lines = []
    lines.append("# ComfyUI カスタムノード セキュリティレポート\n")
    lines.append(f"- スキャン対象: {md_code_span(custom_nodes_dir)}")
    lines.append(f"- 検出ノード数: {len(reports)}\n")

    if referenced_class_types is not None:
        lines.append("## ワークフローから抽出した class_type (参考)")
        lines.append("フォルダ名と一致しない場合があるため、目視で対応関係を確認してください。\n")
        for ct in sorted(referenced_class_types):
            lines.append(f"- {md_code_span(ct)}")
        lines.append("")

    lines.append("## サマリー\n")
    lines.append("| ノード | リスクレベル | 危険呼び出し件数 | ネットワーク通信 | requirements件数 |")
    lines.append("|---|---|---|---|---|")
    for r in reports_sorted:
        lines.append(f"| {md_text(r.name)} | {r.risk_level()} | {len(r.findings)} | {len(r.network_hits)} | {len(r.requirements)} |")
    lines.append("")

    lines.append("## 詳細\n")
    for r in reports_sorted:
        lines.append(f"### {md_text(r.name)}")
        lines.append(f"- パス: {md_code_span(r.path)}")
        lines.append(f"- リスクレベル: **{r.risk_level()}**")
        if r.blacklisted:
            lines.append(f"- ⚠️ ComfyUI-Manager ブラックリストに一致: {md_text(r.blacklist_reason)}")
        if r.findings:
            lines.append("\n**危険な可能性のある呼び出し:**\n")
            for f in r.findings:
                rel = os.path.relpath(f.file, r.path)
                lines.append(f"- {md_code_span(f'{rel}:{f.line}')} — {f.detail}")
                if f.snippet:
                    lines.extend("  " + ln for ln in md_code_block(f.snippet, "python"))
        if r.network_hits:
            lines.append("\n**ネットワーク関連モジュールの使用:**\n")
            for path_, lineno, mod in r.network_hits:
                rel = os.path.relpath(path_, r.path)
                lines.append(f"- {md_code_span(f'{rel}:{lineno}')} — import {md_text(mod)}")
        if r.rejected_requirements:
            lines.append("\n**⚠️ pip-audit に渡さなかった requirements 行:**\n")
            lines.append("取得先を差し替えうるオプション行や、URL/VCS/ローカルパスの直接指定です。")
            lines.append("それ自体が不審な兆候になりうるので、中身を目視で確認してください。\n")
            for req_file, line in r.rejected_requirements:
                lines.append(f"- {md_code_span(os.path.relpath(req_file, r.path))}: {md_code_span(line)}")
        if r.requirements:
            lines.append("\n**requirements:**")
            lines.extend(md_code_block("\n".join(r.requirements)))
        if not r.findings and not r.network_hits and not r.rejected_requirements:
            lines.append("\n目立った兆候は検出されませんでした(静的解析の限界にご注意ください)。")
        lines.append("")

    lines.append("## pip-audit 結果(依存パッケージの既知脆弱性)\n")
    lines.extend(md_code_block(pip_audit_output))
    lines.append("")

    lines.append("## 注意事項")
    lines.append("- これは静的解析による一次スクリーニングです。難読化されたコードや動的に組み立てられた文字列は検出できません。")
    lines.append("- 呼び出し名は import の別名(`from os import system` や `import os as o`)まで辿って解決していますが、`getattr` などで動的に組み立てられた呼び出しは追えません。")
    lines.append("- 「危険な呼び出し」があるからといって即座に悪意があるとは限りません(正当な用途で使われることも多いです)。中身を目視確認してください。")
    lines.append("- ブラックリストはリポジトリ名との完全一致で突合しています。フォルダ名を変えて clone されている場合は当たりません。")
    lines.append("- ComfyUI-Managerのブラックリストは取得先の仕様変更やネットワーク状況により取得できないことがあります。")

    Path(output_path).write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
