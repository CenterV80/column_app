# column_app デプロイ手順ガイド

このドキュメントは、column_app プロジェクトの開発からデプロイまでの手順をまとめています。

## 📋 目次

1. [ローカル開発環境](#ローカル開発環境)
2. [Git ワークフロー](#git-ワークフロー)
3. [自動デプロイ（GitHub Pages）](#自動デプロイgithub-pages)
4. [手動デプロイ](#手動デプロイ)
5. [トラブルシューティング](#トラブルシューティング)

---

## ローカル開発環境

### セットアップ

```bash
# リポジトリをクローン
git clone https://github.com/CenterV80/column_app.git
cd column_app

# ローカルサーバーを起動
python3 -m http.server 8000
```

### ローカルで確認

ブラウザで `http://localhost:8000` にアクセスしてコンテンツを確認します。

---

## Git ワークフロー

### 1. フィーチャーブランチの作成

新しい機能やコンテンツを追加する場合は、`main` ブランチから新しいブランチを作成します。

```bash
# main ブランチから新しいブランチを作成
git checkout main
git pull origin main
git checkout -b claude/feature-name-xxxxx
```

**ブランチ名の例：**
- `claude/git-beginner-glossary-l71z9l`
- `claude/desmos-calculator-app-fla0de`

### 2. コンテンツの作成・編集

必要なファイルを作成または編集します。

**新しいコンテンツを追加する場合の流れ：**

```bash
# 新しいHTMLファイルを作成
# 例: github-glossary.html

# categories.js にコンテンツを登録（必要な場合）
# 例: ポータルサイトに表示させたい場合
```

**categories.js への登録例：**

```javascript
{
  id: "github-glossary",
  name: "GitHub用語辞典",
  description: "初心者向けのGitHub・Git用語を、わかりやすく解説しています。",
  path: "github-glossary.html",
  icon: "🚀",
}
```

### 3. コミットとプッシュ

変更をコミットして、リモートブランチにプッシュします。

```bash
# ファイルをステージング
git add .

# コミット（わかりやすいメッセージを）
git commit -m "GitHub初心者向け用語辞典を作成

- Markdown形式とHTML形式の2つのファイルを作成
- 初心者向け基本用語9つ
- 中級者向け用語6つ
- 上級者向け用語7つ

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PHcAUqw5RK8FdWzK5fHTCo"

# リモートブランチにプッシュ
git push -u origin claude/feature-name-xxxxx
```

### 4. Pull Request（PR）の作成

GitHub から Pull Request を作成します。

**PR作成時のポイント：**
- わかりやすいタイトルと説明を記載
- 変更内容を簡潔にまとめる
- スクリーンショットがあれば含める

**PR テンプレート（記載例）：**

```markdown
## 概要
[短い説明]

## 追加内容
- [項目1]
- [項目2]

## 変更内容
[詳細な説明]

## 確認項目
- [ ] ローカルで動作確認済み
- [ ] コンテンツが正しく表示される
```

### 5. PR のレビュー・マージ

PR がレビューされ、承認されたらマージします。

```bash
# GitHub UI でマージボタンをクリック
# または CLI で:
# gh pr merge <PR番号>
```

---

## 自動デプロイ（GitHub Pages）

### デプロイの仕組み

`main` ブランチへのプッシュ or マージ時に、GitHub Actions ワークフローが自動的に実行され、GitHub Pages に デプロイされます。

**ワークフローファイル：** `.github/workflows/deploy-pages.yml`

### デプロイ対象ブランチ

現在、以下のブランチが GitHub Pages に自動デプロイされます：

```yaml
branches:
  - main  # 本体
  - claude/desmos-calculator-app-fla0de
  - claude/ltx2-3-video-ai-guide-9phckk
  - claude/git-beginner-glossary-l71z9l  # 新しく追加したブランチ
```

### デプロイ完了確認

1. **GitHub Actions で確認**
   - リポジトリの「Actions」タブを開く
   - 「Deploy to GitHub Pages」ワークフローの実行状況を確認

2. **GitHub Pages で確認**
   - `https://centerv80.github.io/column_app/` にアクセス

3. **実行時間**
   - デプロイは通常 1〜3 分で完了

---

## 手動デプロイ

### GitHub Actions で手動実行

ワークフローが自動実行されない場合、手動でトリガーできます。

**方法 1: GitHub UI から**

1. リポジトリの「Actions」タブを開く
2. 「Deploy to GitHub Pages」ワークフローをクリック
3. 右側の「Run workflow」ボタンをクリック
4. ブランチを選択して「Run workflow」を実行

**方法 2: CLI から（gh コマンド使用）**

```bash
gh workflow run deploy-pages.yml --ref main
```

**方法 3: Claude Code から**

```bash
# GitHub Actions ワークフローを実行
git push origin main  # 確実にプッシュ
# または GitHub UI / CLI でワークフローを手動実行
```

---

## デプロイ後の確認チェックリスト

デプロイ完了後、以下を確認してください。

- [ ] `https://centerv80.github.io/column_app/` にアクセスできる
- [ ] ポータルページにすべてのカテゴリが表示される
- [ ] 新しいコンテンツ（例: GitHub用語辞典）が表示される
- [ ] リンク（例: 用語辞典へのリンク）が正しく機能する
- [ ] スタイル（CSS）が正しく適用されている

---

## トラブルシューティング

### デプロイが実行されない

**原因 1: ブランチが deployment ワークフローに登録されていない**

```yaml
# .github/workflows/deploy-pages.yml を編集
on:
  push:
    branches:
      - main
      - claude/your-branch-name  # ここに追加
```

**原因 2: GitHub Pages が有効になっていない**

1. リポジトリの Settings を開く
2. Pages を選択
3. Source が「GitHub Actions」に設定されていることを確認

### ページが更新されない

1. **キャッシュをクリア**
   ```bash
   Ctrl + Shift + R (または Cmd + Shift + R)
   ```

2. **GitHub Actions の実行ログを確認**
   - Actions タブで最新の実行状況を確認
   - エラーメッセージがないか確認

3. **デプロイ URL を再確認**
   - `https://centerv80.github.io/column_app/` にアクセス

### ワークフロー実行エラー

**エラーログの確認方法：**

1. Actions タブで「Deploy to GitHub Pages」をクリック
2. 失敗した実行をクリック
3. 「deploy」ジョブの詳細を確認

**一般的なエラー：**

| エラー | 原因 | 解決策 |
|------|------|------|
| `Permissions` エラー | GitHub Pages の権限不足 | リポジトリの Settings → Pages で権限を確認 |
| `Not found` エラー | ファイルが見つからない | ファイルが正しくコミット・プッシュされているか確認 |
| `Timeout` エラー | デプロイに時間がかかりすぎている | 大容量ファイルがないか確認 |

---

## よくある質問（FAQ）

### Q: 自分のブランチも自動デプロイされるようにしたい

A: `.github/workflows/deploy-pages.yml` に新しいブランチを追加してください。

```yaml
branches:
  - main
  - claude/your-new-branch  # ここに追加
```

### Q: デプロイを止めたい

A: `.github/workflows/deploy-pages.yml` からブランチを削除するか、ワークフローを Disable します。

### Q: 複数の環境にデプロイしたい

A: 複数のワークフローを作成するか、既存ワークフローを拡張してください。

```yaml
deploy:
  - runs-on: ubuntu-latest
    steps:
      - name: Deploy to GitHub Pages
        ...
      - name: Deploy to Custom Server
        ...
```

---

## 参考リンク

- [GitHub Pages の公式ドキュメント](https://docs.github.com/en/pages)
- [GitHub Actions の公式ドキュメント](https://docs.github.com/en/actions)
- [このプロジェクトのワークフロー](.github/workflows/deploy-pages.yml)

---

**最終更新：** 2026年8月1日
