# npm入門まとめ

*公開: 2026-10-02*

## 全体像

- **Node.js**：JavaScriptをブラウザの外（PCのターミナル）で動かす実行環境。npmはこれに同梱されている（Python本体とpipの関係）。
- **npm**：JS/TSのライブラリやツールを取ってくるパッケージ管理ツール。React、Vite、ESLint、Tailwind CSS、three.jsなど、Web開発で使うものは大体npmから来る。
- **three.js**：npmで入れるライブラリの一例（`npm install three`）。CDN（`<script>`タグ）でも使えるが、Viteなどでプロジェクトを組むならnpmで入れるのが普通。

## ファイル・フォルダ

| npm | Pythonでいうと | 役割 |
|---|---|---|
| package.json | requirements.txt | 依存の宣言書。`npm install xxx` で自動追記される |
| package-lock.json | pip freezeの出力 | 依存の依存まで含め、実際に入れた版を完全固定。**Gitに入れる** |
| node_modules/ | venvのsite-packages | ライブラリ本体。プロジェクトごとに自動で隔離される。**Gitには入れない** |

## コマンド

| コマンド | 内容 |
|---|---|
| `npm init -y` | package.jsonを作ってプロジェクト開始 |
| `npm install パッケージ名` | ライブラリを追加・更新し、package.jsonとlockに記録 |
| `npm install` | package.jsonのあるフォルダで実行すると全部ダウンロード。lockが更新されることもある |
| `npm ci` | lockの通りに厳密に再現。lockは書き換えない |
| `npm run 名前` | package.jsonの `scripts` に書いたコマンドを実行（`npm run dev` など） |

### npm install と npm ci の違い

| | npm install | npm ci |
|---|---|---|
| 基準にするもの | package.json（lockも参考） | package-lock.jsonだけ |
| lockを書き換えるか | 書き換えることがある | 絶対に書き換えない |
| package.jsonとlockが食い違ったら | lockを更新して進む | エラーで止まる |
| 既存のnode_modules | 差分だけ更新 | 全部消して入れ直す |
| lockがないとき | 新しく作る | エラーで止まる |

**使い分け：ライブラリを追加するときは `install`、cloneしたプロジェクトや環境の作り直しは `ci`**

## バージョン表記

`"react": "^18.2.0"` の `^` は「18.x.x の範囲なら新しくてもOK」という意味。便利だが、知らないうちに新しい版が入る原因にもなる。

## npm install で起きていること

1. package.jsonを読み、必要なパッケージとその依存を全部洗い出す（数百個になることも普通）
2. npmレジストリ（npmjs.com）からダウンロードしてnode_modulesに展開
3. 各パッケージの `postinstall` などのスクリプトを**自動実行** ← ここが危険

## 安全に使うための3本柱

1. **インストールスクリプトを止める**：`~/.npmrc` に `ignore-scripts=true`。攻撃の主な入口を塞ぐ。ネイティブビルドが必要なものだけ `npm rebuild <pkg> --ignore-scripts=false` で個別に対応（`--ignore-scripts=false` を付けないと、rebuildでもスクリプトは実行されない）。
2. **lockをコミットして `npm ci`**：記録された検証済みのバージョンしか入れない。
3. **公開直後の版を避ける**：pnpmなら `minimumReleaseAge`（例: 1440分＝1日）。乗っ取られた版は短時間で取り下げられることが多い。

## 入れる前の習慣

- 名前の打ち間違いに注意（1文字違いの偽パッケージ＝typosquatting）。コピペで確認する。
- npmjsのページで週間DL数・最終更新日・メンテナ数・GitHubリンクを一瞥。Socket.devのページも参考になる。
- 知らないパッケージを `npx` で気軽に実行しない（ダウンロードして即実行と同じ）。

## 運用

- `npm audit` で既知の脆弱性をチェック、`npm outdated` で古い依存を把握。
- 数行で書ける機能のために依存を増やさない。
- pnpm（v10以降）は依存のビルドスクリプトがデフォルトで許可制なので、乗り換えも選択肢。

## 次のステップ

空フォルダで `npm init -y` → `npm install three` を試し、生成された package.json / package-lock.json / node_modules を実際に眺めてみる。
