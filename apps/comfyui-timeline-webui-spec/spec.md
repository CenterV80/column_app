# ComfyUI 動画生成用タイムラインWeb UI 技術仕様書

## 1. 概要・目的

ComfyUIの動画生成ワークフローは、ノードベースUIが複雑でチーム内の非技術者でも扱いにくい。特にタイムライン上に複数の画像をドラッグ&ドロップで時間軸配置する操作は、ComfyUI標準の「App Mode」(フォーム型UI)では表現できない。

本仕様書では、ComfyUIを**実行エンジン(バックエンド)として利用し**、タイムラインUIを備えた**独自Webフロントエンド**を新規開発する構成を定義する。フロントエンドはComfyUIサーバーのAPIを直接呼び出す構成とし、中間サーバーは設けない。

## 2. 全体アーキテクチャ

```
[ユーザー]
   │ 画像アップロード・タイムライン配置
   ▼
[フロントエンド (SPA)]
   │ REST API / WebSocket (直接呼び出し)
   ▼
[ComfyUIサーバー]
   │ 実行
   ▼
[生成結果 (動画/画像ファイル)]
```

- **フロントエンド**: タイムライン操作専用のSPA。React想定。ワークフローJSONのテンプレート管理・書き換え・ComfyUI APIへのリクエスト送信をすべてクライアント側で行う。
- **ComfyUIサーバー**: 既存の動画生成ワークフローを実行するのみ。ノードUIは直接ユーザーに見せない。

中間サーバーを省略するため、ワークフローJSONのテンプレートやノード対応表はフロントエンドの静的リソース(またはビルド時埋め込み)として保持する。社内アカウント利用かつ社内ネットワーク限定であることを前提とし、認証・CORS設定でアクセス範囲を制御する(詳細は8章・9章参照)。

## 3. 前提: ワークフローの準備

1. ComfyUI上で対象の動画生成ワークフローを完成させる
2. 「Save (API Format)」でワークフローJSONをエクスポートし、`workflow_template.json` としてフロントエンドのリソースに配置する
3. JSON内で、タイムライン操作に対応させるノードを特定し、以下の対応表を作成する

| タイムライン上の要素 | 対応するノードID | 対応する入力キー | 型 |
|---|---|---|---|
| 各キーフレームの画像 | (要調査・記入) | 例: `image` | string (ファイル名/パス) |
| 各キーフレームの開始フレーム番号 | (要調査・記入) | 例: `start_frame` | int |
| 各キーフレームの継続長 | (要調査・記入) | 例: `duration` | int (frame数) |
| 出力FPS | (要調査・記入) | 例: `fps` | int |
| 出力解像度 | (要調査・記入) | 例: `width`, `height` | int |

> 実際のワークフローJSONを確認し、この対応表を確定させることが実装着手前の必須タスク。ノード構成によっては、複数画像を一括で受け取る「バッチ入力ノード」1つに配列として渡す設計になる場合もある。

## 4. データモデル

### 4.1 タイムラインの内部データ構造(フロントエンド)

```typescript
interface TimelineClip {
  id: string;              // UUID
  imageId: string;          // ComfyUIにアップロード済み画像のファイル名(ComfyUI側の name)
  startFrame: number;        // 開始フレーム
  durationFrames: number;    // 継続フレーム数
  track: number;             // トラック番号(複数レイヤー対応時)
}

interface TimelineProject {
  fps: number;
  width: number;
  height: number;
  clips: TimelineClip[];
}
```

### 4.2 ワークフローJSONへの変換処理(フロントエンド内部)

フロントエンドは `workflow_template.json` をメモリ上にロードし、`TimelineProject` の内容を「3. 対応表」に基づいて該当ノードの `inputs` に直接書き込んでから、ComfyUIの `/prompt` エンドポイントに送信する。この変換ロジックはフロントエンド内の専用モジュール(例: `buildWorkflowPayload(project): ComfyWorkflowJSON`)として実装する。

## 5. ComfyUI API 連携仕様(フロントエンドから直接呼び出し)

### 5.1 画像アップロード

```
POST {COMFY_HOST}/upload/image
Content-Type: multipart/form-data

Request: image=<binary>, overwrite=false
Response: { "name": "xxx.png", "subfolder": "", "type": "input" }
```

返却された `name` を `TimelineClip.imageId` として保持し、タイムライン上の画像参照に使う。

### 5.2 生成ジョブの開始

```
POST {COMFY_HOST}/prompt
Content-Type: application/json

Request: { "prompt": <4.2で生成したワークフローJSON>, "client_id": "<フロントエンドで発行するUUID>" }
Response: { "prompt_id": "...", "number": ..., "node_errors": {} }
```

`client_id` はWebSocket接続時にも同じ値を使用し、自分が送信したジョブのメッセージだけを識別するために使う。

### 5.3 ジョブ状態取得(ポーリング用・フォールバック)

```
GET {COMFY_HOST}/history/{prompt_id}
Response: {
  "<prompt_id>": {
    "status": { "completed": true/false, "status_str": "success" | "error" },
    "outputs": { "<nodeId>": { "gifs" | "videos": [ { "filename": "...", "subfolder": "...", "type": "output" } ] } }
  }
}
```

WebSocketが利用できない環境向けのフォールバックとして、2〜3秒間隔でポーリングする実装を用意する。

### 5.4 進捗通知(WebSocket, 推奨)

```
WS {COMFY_HOST}/ws?clientId={client_id}

Server → Client メッセージ例:
{ "type": "progress", "data": { "value": 12, "max": 30, "prompt_id": "..." } }
{ "type": "executing", "data": { "node": "12", "prompt_id": "..." } }
{ "type": "executed", "data": { "node": "18", "output": {...}, "prompt_id": "..." } }
{ "type": "execution_error", "data": { "prompt_id": "...", "exception_message": "..." } }
```

フロントエンドは自分の `client_id` に紐づくメッセージのみを処理し、`progress` を進捗バーに、`execution_error` をエラー表示に反映する。

### 5.5 生成結果の取得

```
GET {COMFY_HOST}/view?filename={filename}&subfolder={subfolder}&type=output
Response: 動画ファイル(video/mp4等)のバイナリ
```

5.3の `outputs` から得た `filename` / `subfolder` を使って直接取得し、`<video>` タグで再生、またはダウンロードリンクとして提供する。

## 6. フロントエンド画面設計

### 6.1 画面構成

```
+-----------------------------------------------+
| ヘッダー(プロジェクト名・生成ボタン・進捗表示)   |
+---------------+---------------------------------+
| 画像パネル      | プレビュー領域                  |
| (アップロード   | (生成結果 or サムネイル合成表示)  |
|  済み画像一覧    |                                |
|  サムネイル)     |                                |
+---------------+---------------------------------+
| タイムライン領域                                |
| (トラック x フレーム軸、クリップをドラッグ配置)   |
| [ズーム / 再生ヘッド / スナップ設定]              |
+-----------------------------------------------+
```

### 6.2 主要コンポーネント

| コンポーネント | 役割 |
|---|---|
| `ImagePanel` | 画像アップロード、サムネイル一覧、ドラッグ元 |
| `Timeline` | フレーム軸表示、トラック管理、ズーム/スクロール |
| `TimelineClip` | 個別クリップ(ドラッグ移動・リサイズで duration 変更) |
| `PlayheadIndicator` | 現在フレーム位置の表示 |
| `GenerateButton` | ジョブ開始トリガー、二重送信防止 |
| `ProgressBar` | WebSocketからの進捗を表示 |
| `ResultViewer` | 完成動画のプレビュー・ダウンロード |
| `ComfyClient` | `/upload/image`・`/prompt`・`/history`・`/ws`・`/view` を扱うAPIクライアント層 |

### 6.3 操作フロー

1. 画像パネルから画像をアップロード(5.1のAPI呼び出し)
2. サムネイルをタイムライン上にドラッグ&ドロップしてクリップ生成
3. クリップの端をドラッグして `durationFrames` を調整、クリップ本体をドラッグして `startFrame` を調整
4. 「生成」ボタン押下 → 4.2の変換処理でワークフローJSON生成 → 5.2のAPI呼び出し → `prompt_id` 受領
5. WebSocket接続(5.4)、または5.3のポーリングで進捗表示
6. 完了後、`ResultViewer` で動画を再生・ダウンロード可能に

### 6.4 バリデーション(フロントエンド側)

- クリップ同士の重複(同一トラック内での時間重なり)を禁止、またはトラック分けを許容するかを事前に決定する
- `startFrame + durationFrames` が全体の最大フレーム数を超えないよう制御
- 画像未配置のまま生成ボタンを押せないようにする

## 7. エラーハンドリング

| ケース | 対応 |
|---|---|
| ComfyUIサーバーに接続できない | フロントエンドで`{COMFY_HOST}`への疎通チェックを行い、明示的なエラーメッセージを表示 |
| ワークフロー実行中にノードエラー発生 | WebSocketの `execution_error`、または `/history` の `status_str` を解析し、ユーザー向けメッセージに変換して表示 |
| 画像アップロード失敗 | リトライ導線をUIに用意 |
| `/prompt` 送信時に `node_errors` が返る | ワークフローJSONの書き換えミス(対応表のズレ)の可能性が高いため、開発者向けログに詳細を出力しつつユーザーには簡潔なメッセージを表示 |
| 生成ジョブがタイムアウト | フロントエンド側でタイムアウト閾値を設定し、それを超えたら失敗扱いにする |

## 8. 非機能要件

- **同時実行制御**: ComfyUIは基本的に1ジョブずつキュー処理されるため、キューの状態(実行中/待機中)をユーザーに表示する
- **CORS設定**: フロントエンドから直接ComfyUIサーバーを叩くため、ComfyUI起動時に `--enable-cors-header` 等でフロントエンドのオリジンを許可する設定が必要
- **アクセス制御**: ComfyUIサーバー自体には認証機構が標準搭載されていないため、社内ネットワーク限定アクセス(VPN/社内LAN)やリバースプロキシでのBasic認証・SSO連携など、ネットワークレイヤーでのアクセス制御が別途必須
- **ファイル保持**: アップロード画像・生成結果の保持期間、ストレージ容量の上限を運用ルールとして決定する
- **ログ**: `prompt_id`・実行時間・エラー内容をフロントエンド側(またはブラウザの外部ログ収集サービス)に記録する方式を検討する

## 9. 未確定事項(実装着手前に決定が必要)

- [ ] 3章の「タイムライン要素と対応表」を実際のワークフローJSONを見て確定させる
- [ ] ComfyUIサーバーへのアクセス制御方式(VPN限定/リバースプロキシ認証など)
- [ ] 複数トラック(レイヤー)対応の要否
- [ ] ホスティング環境(社内サーバー / クラウド)
- [ ] `workflow_template.json` の更新運用(ワークフロー改修時にフロントエンドの静的リソースも都度更新が必要になる点への対応)
