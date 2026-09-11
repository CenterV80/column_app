# 絵コンテ追従 動画生成機能 技術仕様書
MiniMax H3 / ComfyUI WebUI

| 項目 | 内容 |
|---|---|
| 版 | v0.2（ドラフト）：DiT int8 pruned 採用、既定8ステップに変更 |
| 作成日 | 2026-09-11 |
| ステータス | 検証前。「要検証」「要確認」の項目は検証計画（14章）の結果で確定させる |

---

## 1. 目的・背景

絵コンテ（コマ画像＋動画プロンプト）から MiniMax H3 で動画を生成する際、現状は絵コンテ画像を Ref2V の参照画像として渡しているが、構図・レイアウトへの追従が弱い。

原因は、Ref2V の参照画像（`<Picture N>`）が時間軸に紐づかない「素材」として扱われ、人物・物・スタイルの抽出には効くが「この時刻にこの構図」という指示にはならないためと考えられる。

本仕様では、役割の異なる3系統の制御を組み合わせ、WebUI のタイムラインから一元的に制御できるようにする。

- キャラクターの同一性 → Ref2V 参照（従来通り）
- 時刻ごとの見た目のアンカー → `MiniMaxH3AddGuide`
- 構図・構造の追従 → Fun ControlNet Union（サンプリング前半のみ適用）

latent への直接書き込みは行わず、conditioning 側（AddGuide）と transformer ブロック注入側（ControlNet パッチ）で効かせる方針とする（LTX で latent にキーフレームを直接注入した際に動きが止まった経験を踏まえた方針）。

## 2. スコープ

**対象**
- WebUI タイムライン上のキーフレーム・ショット・キャラ参照から、ComfyUI API 形式のワークフロー JSON を動的に生成する処理
- 時間→フレーム変換、プロンプトコンパイル、コントロール動画の組み立て
- 2パスサンプリングによる ControlNet 適用区間の制御
- 各方式の効果を比較する検証計画

**対象外**
- 絵コンテツール本体（字コンテ→ラフ生成、Gemini 側）
- ラフの清書（完成画キーフレーム化）の自動化。検証計画 E2 では手動で用意する
- 15秒を超える長尺生成（ショット連結）

## 3. 前提環境

| 項目 | 要件 |
|---|---|
| ComfyUI | 0.35.0 以上（Fun ControlNet Union のネイティブテンプレートの要件。AddGuide は 0.34.0 で追加） |
| 構成 | 中間サーバー（BFF）なし。WebUI から ComfyUI サーバーの API を直接呼ぶ |
| 拡張 | サードパーティのカスタムノードは使用しない（コアノードのみで構成） |
| GPU | 開発機 RTX5080。15秒生成は重いため、検証は5秒で行う |

**使用モデル**

| 種別 | ファイル | 配置先 |
|---|---|---|
| Diffusion | `minimax_h3_ref2va_pruned_int8_convrot`（参照あり時）/ `minimax_h3_fl2va_pruned_int8_convrot`（参照なし時） | `models/diffusion_models/` |
| ControlNet パッチ | `minimax_h3_fun_controlnet_union_pruned_int8_convrot` | `models/model_patches/` |
| Text Encoder | `qwen3vl_32b_minimax_h3_*`（CLIPLoader の type は `minimax`） | `models/text_encoders/` |
| VAE | `minimax_h3_video_vae_fp16` / `minimax_h3_audio_vae_fp32` | `models/vae/` |

fl2va と ref2va は別学習のチェックポイントで互換性がないため、参照画像の有無でどちらを使うかを切り替える。

DiT は int8 pruned 版を標準とする。pruned 版の DiT と、オリジナル（非 pruned）の Fun ControlNet は重みの形式が異なり組み合わせられないため、ControlNet も必ず pruned 版を使う。この組み合わせ（ref2va pruned int8 ＋ ControlNet pruned int8）は公式テンプレートと同一。

## 4. 方式概要

| 系統 | 担うもの | 入力 | 配線上の位置 |
|---|---|---|---|
| Ref2V 参照 | キャラの同一性・衣装・画風 | キャラシート画像 | Reference to Video ノード（conditioning と latent を生成） |
| AddGuide | 指定時刻のフレームの見た目 | キーフレーム画像＋frame_idx | conditioning ライン（positive） |
| Fun ControlNet | 構図・レイアウト・ポーズ | 全フレーム分のコントロール動画 | model ライン（パッチ） |
| 2パス切替 | ControlNet の効く範囲（＝追従の強さ） | 切替ステップ | サンプラー |

```
UNETLoader ──┬──────────────────────────────→ model_plain ─→ BasicGuider(後半)
             └→ ApplyFunControlNet ──────────→ model_cn ────→ BasicGuider(前半)
                   ↑ control_video（コントロール動画の組み立て、10章）

CLIPLoader ─→ ReferenceToVideo ─┬→ positive → AddGuide(1) → AddGuide(2) → … → positive_final
  (キャラ参照)                   └→ latent ──┬→ 各 AddGuide の latent 入力
                                             └→ サンプラー（前半パス）

前半パス: SamplerCustomAdvanced(RandomNoise, guider=前半, sigmas=high) → latent_mid
後半パス: SamplerCustomAdvanced(DisableNoise, guider=後半, sigmas=low, latent=latent_mid)
          → VAEDecode(ビデオVAE) ＋ VAEDecodeAudio(オーディオVAE) → CreateVideo
```

`positive_final` は前半・後半の両方の BasicGuider に渡す。AddGuide はどちらのパスでも有効とする。

## 5. モデル仕様上の制約

| 項目 | 値 | 備考 |
|---|---|---|
| フレームレート | 24fps 固定 | |
| 尺 | 4〜15秒 | |
| フレーム数グリッド | 17k+5（5, 22, 39, …, 124, …） | 5秒指定は124フレーム（約5.17秒）にスナップされる |
| VAE 圧縮 | 空間16倍・時間4倍・24ch（f16t4d24） | 17k+5 グリッドと単純な4倍の関係は未解明 |
| 推奨解像度 | 短辺768px（テンプレート既定） | |
| 参照上限 | 画像9枚、動画3本（計15秒以内）、音声3本、合計12ファイル | MiniMax モデルカード準拠 |
| サンプラー | `res_multistep` / `simple` / 8ステップ / BasicGuider（CFGなし） | 8ステップまで落として品質を確認済み。参照が多い場合は `beta` / `normal` も候補 |

**AddGuide の制約**（公式ドキュメントより）
- `image` か `audio` のどちらかが必須。`image` 接続時は `vae` が必須
- `latent` 入力は必須だが参照のみで、出力は `positive`（conditioning）だけ
- `frame_idx` は動画のフレーム範囲内でなければエラー。負の値は末尾から数える
- 5枚未満の画像バッチは1枚目のみ使用。5枚以上は有効クリップ長に切り詰め

**Fun ControlNet の制約**
- コントロール動画は毎フレーム分を前提とする
- ターゲットより長い場合は先頭から切り詰め、短い場合は最後のフレームがホールドされる
- `guidance_scale` は1.0 固定。`strength` はパッチ側で調整

## 6. データモデル

WebUI 内部で保持するデータ。永続化形式も同一とする。

```ts
type Seconds = number;

interface GenerationJob {
  id: string;
  settings: GenerationSettings;
  characters: CharacterRef[];   // Ref2V 参照
  shots: Shot[];                // プロンプトのショット
  keyframes: Keyframe[];        // 絵コンテのコマ
}

interface GenerationSettings {
  durationSec: Seconds;         // 入力値。実フレーム数は snapLength で決定
  width: number;
  height: number;
  seed: number;
  steps: number;                // 既定 8
  sampler: string;              // 既定 "res_multistep"
  scheduler: string;            // 既定 "simple"
  control: ControlSettings;
  useGuides: boolean;           // AddGuide 系統の ON/OFF
}

interface ControlSettings {
  enabled: boolean;
  splitStep: number;            // 0 = 無効, steps = 全ステップ適用
  strength: number;             // 既定 1.0
  preprocess: "none" | "invert" | "canny";
  mode: "hold" | "window";
  windowFrames: number;         // mode = "window" のときの前後フレーム数
  filler: "black" | "white";    // window 外を埋める色（要検証 E5）
}

interface CharacterRef {
  id: string;
  label: string;                // 例 "主人公"
  imageName: string;            // /upload/image 後のファイル名
  subjectIndex: number;         // <Subject N> の N（1始まり）
}

interface Shot {
  id: string;
  startSec: Seconds;            // 先頭ショットは 0
  text: string;                 // 例 "@主人公 が振り返る"
}

interface Keyframe {
  id: string;
  timeSec: Seconds;
  imageName: string;
  source: "rough" | "clean";    // ラフ or 清書済み
  useAsGuide: boolean;          // AddGuide に使う
  useAsControl: boolean;        // コントロール動画に使う
}
```

ラフは原則 `useAsControl` のみ、清書済みは `useAsGuide` のみを既定値とする（ラフを AddGuide に入れると、そのフレームがラフの見た目に引っ張られる可能性が高いため）。

## 7. 時間→フレーム変換

```ts
const FPS = 24;

// 尺 → 17k+5 グリッドに切り上げ
function snapLength(sec: Seconds): number {
  const raw = Math.round(sec * FPS);
  const k = Math.max(0, Math.ceil((raw - 5) / 17));
  return 17 * k + 5;
}

// 秒 → フレーム番号（0始まり）
function secToFrame(sec: Seconds, length: number): number {
  const f = Math.round(sec * FPS);
  return Math.min(Math.max(f, 0), length - 1);
}

// フレーム番号 → プロンプト用タイムスタンプ "MM:SS.mmm"
function frameToStamp(frame: number): string {
  const ms = Math.round((frame / FPS) * 1000);
  const mm = Math.floor(ms / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  const mmm = ms % 1000;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(mmm).padStart(3, "0")}`;
}
```

- タイムライン UI のスナップ単位は、当面1フレームとする。検証 E4 で AddGuide の実効粒度が判明したら、その単位に変更する
- 尺が 4〜15 秒の範囲外なら生成ボタンを無効化する

## 8. プロンプトコンパイル

MiniMax 公式のプロンプト記法に従い、タイムラインから1本のプロンプトを生成する。ショットのタイムスタンプとキーフレームの frame_idx は、必ず同じタイムラインデータから算出する（両者の食い違いを防ぐため）。

```
subject_definitions: <Subject 1> is the character shown in <Picture 1>. <Subject 2> is …

retention_analysis: Keep the identity, face and clothing of <Subject 1> consistent across every shot.

detailed_description: [Shot 1] <1ショット目の本文>
[Shot 2] At 00:01.500, <2ショット目の本文>
```

**ルール**
- `@ラベル` は対応する `<Subject N>` に展開する
- `subject_definitions` は、参照画像が1枚以上あるときのみ出力する
- 先頭ショットはタイムスタンプなし。2ショット目以降は `startSec` から `frameToStamp` で生成し、狭義単調増加でなければエラーにする
- AddGuide の画像はプロンプトから参照しない（`<Picture N>` の番号はキャラ参照だけで消費する）
- コンパイル結果は生成前に UI で全文プレビューする

## 9. ワークフロー構築

### 9.1 テンプレート方式

ComfyUI 上で基本ワークフローを組み、API 形式でエクスポートした JSON をテンプレートとして WebUI に同梱する。可変部分（AddGuide チェーン、コントロール動画組み立て、2パス切替）は WebUI 側でノードを動的に追加・削除する。

- テンプレート内の固定ノードには、固定 ID（例 `"unet"`, `"r2v"`, `"cn_apply"`, `"sampler_hi"`）を振っておく
- 動的ノードの ID は `guide_1`, `guide_2`, `ctl_rep_1` のように接頭辞＋連番で生成する
- ノードのクラス名と入力名は、テンプレートからそのまま取得する。ドキュメントの表記と実際が異なる場合があるため、コード内にハードコードしない（特に Fun ControlNet の適用ノード、Reference to Video ノードは要確認）

### 9.2 ノード一覧

| 役割 | クラス名 | 確度 |
|---|---|---|
| キャラ参照＋conditioning＋latent 生成 | `MiniMaxH3ReferenceToVideo` | 入出力名は要確認 |
| 時刻アンカー | `MiniMaxH3AddGuide` | 公式ドキュメントで確認済み |
| ControlNet パッチ読み込み・適用 | 公式テンプレートのノード | テンプレートから取得 |
| スケジューラ | `BasicScheduler` | コア |
| ステップ分割 | `SplitSigmas` | コア |
| ガイダー | `BasicGuider` | コア |
| サンプラー | `SamplerCustomAdvanced` / `KSamplerSelect` | コア |
| ノイズ | `RandomNoise` / `DisableNoise` | コア |
| デコード | `VAEDecode` / `VAEDecodeAudio` / `CreateVideo` | コア |
| コントロール動画組み立て | `LoadImage` / `ImageScale` / `RepeatImageBatch` / `ImageBatch` / `ImageInvert` / `Canny` | コア |

### 9.3 AddGuide チェーンの生成

`useAsGuide` のキーフレームを時刻順に並べ、直列に接続する。

```ts
let prevPositive: [string, number] = ["r2v", 0];   // 出力インデックスはテンプレートに合わせる
guides.forEach((kf, i) => {
  const id = `guide_${i + 1}`;
  wf[`load_guide_${i + 1}`] = { class_type: "LoadImage", inputs: { image: kf.imageName } };
  wf[id] = {
    class_type: "MiniMaxH3AddGuide",
    inputs: {
      positive: prevPositive,
      latent: ["r2v", 1],                            // 全 AddGuide に同じ latent を並列で渡す
      frame_idx: secToFrame(kf.timeSec, length),
      vae: ["video_vae", 0],
      image: [`load_guide_${i + 1}`, 0],
    },
  };
  prevPositive = [id, 0];
});
// prevPositive を前半・後半両方の BasicGuider の conditioning に接続
```

### 9.4 2パスサンプリング

| splitStep | 挙動 |
|---|---|
| 0 | ControlNet なし。1パス（素の model）で全ステップ |
| 1〜steps−1 | 前半 splitStep ステップを ControlNet 適用 model、残りを素の model |
| steps | ControlNet を全ステップ適用。1パス（ControlNet 適用 model） |

- `BasicScheduler` → `SplitSigmas(step = splitStep)` で `high_sigmas` / `low_sigmas` を得る
- 前半パスは `RandomNoise(seed)`、後半パスは `DisableNoise` を使い、前半の出力 latent をそのまま入力する
- ControlNet パッチは model を clone して登録する想定のため、素の model と適用 model で重みの二重ロードは起きない見込み（要検証：VRAM 使用量で確認）
- `res_multistep` はマルチステップ法のため、パス分割で履歴がリセットされる。8ステップでは1ステップの比重が大きく影響が出やすいため、1パス時との画質差を E3 で確認する
- 8ステップでは切替位置の選択肢が 1〜7 しかなく、1ステップ動かすだけで効き方が大きく変わる。構図が決まる序盤（1〜4）を中心に1刻みで検証する
- H3 の AV latent（ネスト構造）が SamplerCustomAdvanced の出力から次のパスへ正しく受け渡せるか要検証

## 10. コントロール動画の組み立て

`useAsControl` のキーフレームから、ターゲットと同じフレーム数の IMAGE バッチをコアノードのみで組み立てる。

### 10.1 前処理

| preprocess | 処理 | 用途 |
|---|---|---|
| none | そのまま | 清書済み画像や、既に白線／黒地の画像 |
| invert | `ImageInvert` | 白地に黒線のラフを、黒地に白線に変換（HED 系の見た目に寄せる） |
| canny | `Canny` | ラフからエッジを抽出 |

いずれも事前に `ImageScale` で出力解像度に合わせる。

### 10.2 モード

**hold（区間ホールド）**
各キーフレームを、その時刻から次のキーフレームの時刻の直前までリピートする。先頭キーフレームより前は先頭キーフレームで埋める。

```
区間フレーム数 n_i = frame(kf_{i+1}) − frame(kf_i)   （最後は length − frame(kf_last)）
LoadImage → 前処理 → RepeatImageBatch(amount = n_i) → ImageBatch で順に連結
```

構図は強く固定されるが、動きが止まりやすい。splitStep との組み合わせで緩める前提のモード。

**window（前後Nフレームのみ）**
各キーフレームの時刻の前後 `windowFrames` フレームだけにキーフレームを置き、それ以外は filler 色の単色画像で埋める。黒などの無信号フレームが「制約なし」と解釈されるか、「何もない画」として逆に制約になるかは未知（要検証 E5）。

### 10.3 長さの保証

組み立て後のバッチ長が `length` と一致することを、ワークフロー送信前に計算で検証する（不足すると最後のフレームが自動ホールドされ、意図しない固定が起きるため）。

## 11. ComfyUI API 通信

既存 WebUI 仕様書の通信方式に準拠する。本機能で追加・変更する点のみ記載する。

- 画像のアップロードは `POST /upload/image`。キャラ参照・キーフレームを生成前にまとめてアップロードし、返却されたファイル名を `imageName` に保持する
- ワークフロー送信は `POST /prompt`、進捗は WebSocket（`/ws?clientId=…`）、結果は `/history/{prompt_id}` と `/view` で取得する
- 同一画像の再アップロードを避けるため、画像のハッシュと `imageName` の対応をキャッシュする

## 12. UI 仕様

**タイムライン**
- トラック：ショット（プロンプト区間）／キーフレーム（絵コンテのコマ）／キャラ参照（時間軸なし、パネル表示）
- キーフレームのカードに「ガイド」「コントロール」のトグルを持たせる
- ルーラーは秒とフレームを切り替え可能。尺の終端は `snapLength` 後の値で表示する

**制御パネル**
- 「構図の追従」スライダー：splitStep（0〜steps、既定では 0〜8）に対応。表示は「なし / 弱 / 中 / 強 / 最大」とし、内部値はステップ数。各段階に割り当てるステップ数は E3 の結果で決める
- ControlNet strength、前処理、モードの選択
- 各系統（参照／ガイド／コントロール）の ON/OFF を個別に切り替え可能にする（検証の比較用）

**プレビュー**
- コンパイル済みプロンプトの全文表示
- 実フレーム数、各キーフレームの frame_idx、コントロール動画のバッチ長の表示
- 警告一覧（13章）

## 13. バリデーション・警告

| 条件 | 扱い |
|---|---|
| 尺が 4〜15 秒の範囲外 | エラー（生成不可） |
| ショットの開始時刻が単調増加でない | エラー |
| 参照画像が9枚超、または全参照が12ファイル超 | エラー |
| AddGuide の frame_idx が範囲外 | エラー |
| コントロール動画のバッチ長 ≠ length | エラー |
| 参照画像ありで fl2va モデルが選択されている／その逆 | エラー |
| ラフに「ガイド」が ON | 警告（見た目がラフに引っ張られる可能性） |
| 同一フレームに複数のキーフレーム | 警告（後勝ちで統合） |
| control.mode = hold かつ splitStep = steps | 警告（動きが止まりやすい） |

## 14. 検証計画

条件はすべて同一（5秒・同一シード・同一プロンプト・同一キャラ参照・短辺768・8ステップ・DiT int8 pruned）とし、1変数ずつ変える。

| ID | 目的 | 条件 |
|---|---|---|
| E0 | ベースライン | 現行（絵コンテを Ref2V 参照に入れる） |
| E1 | AddGuide にラフを置いた場合の効き | ラフを useAsGuide、ControlNet なし |
| E2 | 追従の弱さがラフの分布ズレによるものか | 清書したキーフレームを useAsGuide、ControlNet なし |
| E3 | ControlNet の適用範囲と動きのトレードオフ | hold モード、steps = 8、splitStep = 1 / 2 / 3 / 4 / 6 / 8。splitStep = 8（2パス）と ControlNet 適用の1パスも比較 |
| E4 | AddGuide の実効時間粒度 | 同一画像の frame_idx を 1 フレームずつずらして比較 |
| E5 | window モードの filler の解釈 | windowFrames = 2 / 6、filler = black / white |
| E6 | 併用効果 | E2 の最良条件 ＋ E3 の最良条件 |

**評価項目**
- 構図の一致度（キーフレーム時刻の生成フレームと絵コンテを並べて目視で5段階評価）
- 動きの量（ホールド区間で動きが止まっていないか、目視で5段階評価）
- キャラの同一性（目視で5段階評価）
- 生成時間、ピーク VRAM

結果は表にまとめ、UI の既定値（splitStep、モード、filler）と、スライダーの段階の割り当てに反映する。

## 15. 未確定事項・リスク

| 項目 | 内容 | 確定方法 |
|---|---|---|
| Ref2V ノードの入出力名 | positive / latent の出力インデックス | テンプレートを API 形式でエクスポートして確認 |
| ControlNet 適用ノード | クラス名・入力名 | 公式テンプレートから取得 |
| Ref2V ＋ AddGuide の併用 | 異なる種類の conditioning の同時投入になり、結果が変わる可能性がある | E2 / E6 |
| AV latent の2パス受け渡し | ネスト構造 latent の後半パスへの入力 | 最小構成で動作確認 |
| 2パス時の画質 | マルチステップサンプラーの履歴リセット | E3（splitStep = 20 と 1パスを比較） |
| AddGuide の時間粒度 | 1フレーム単位か、数フレーム単位に丸められるか | E4 |
| filler の解釈 | 無信号か、制約として働くか | E5 |
| VRAM | ControlNet パッチ追加分と、15秒生成時の負荷 | 実測 |

## 16. 将来拡張

- ラフの自動清書：画像生成でラフ＋キャラシートから完成画キーフレームを作り、`source: "clean"` として取り込む
- コントロールの補間：ポーズのキーポイント補間による、動きのあるコントロール動画の生成
- アニマティック入力：UE／Houdini で作ったブロックアウトから深度・ポーズ動画を書き出して取り込む
- ショット連結による15秒超の生成
