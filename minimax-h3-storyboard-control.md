# 絵コンテ→動画の追従性を上げたい: MiniMax H3のControlNet活用を検討したログ

ComfyUIでMiniMax H3をローカル検証している中で出てきた、「絵コンテツールで描いたラフな構図を、R2V(Reference-to-Video)生成にどう反映させるか」という課題についての検討ログです。

## 発端

MiniMax H3をComfyUI上でローカル検証中(GitHub公式ノード、Comfy-Org配布のプルーニング/量子化版、ライセンスの地域制限などを踏まえた構成)。その延長で、絵コンテツール側から出てくる荒いラフスケッチを、MiniMax H3の動画生成にどう食わせるかという相談が出た。

## 課題設定

- 絵コンテツールの「絵コンテ画像→動画(MiniMax H3)」の追従性を高めたい
- 前提はR2V(Reference-to-Video)：キャラクターや雰囲気は参照画像で維持しつつ、荒いラフスケッチで**レイアウト(構図)**を追加で拘束したい
- コマ数は3枚以上を想定

## 検討した手法とその変遷

1. **latentへの直接キーフレーム注入を提案** → 「LTXではlatent直書きだと動きが止まる」という実体験のフィードバックがあり、この方向は保留に。
2. **conditioning/attention層側で効かせる方向に方針転換**。latentへの減衰的な注入は不安定になりやすいという指摘から、ControlNet的な経路を新設する・クロスアテンションにトークンを追加する・空間層限定で注入するといった選択肢を検討した。

## 前例調査: MiniMax-H3-Fun-Controlnet-Union

検討の途中で、まさに狙っていた構造に近い実装が既に存在することを確認した。Alibaba PAIが公開している[`alibaba-pai/MiniMax-H3-Fun-Controlnet-Union`](https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union)で、VideoX-Fun系列の一つとしてMiniMax H3向けに学習されたControlNet-Unionモデル。

- **アーキテクチャ**: 全50ブロックのトランスフォーマーのうち、5ブロック(0/10/20/30/40番目)にコントロール用の投影層を追加する構成。追加した経路はゼロゲート投影(zero-gated projection)でメインの経路に加算されるため、コントロール強度を絞ればベースの生成能力を壊さずに効かせられる
- **対応control種類**: Canny・Depth・HED・MLSD・Poseの5種類を、チェックポイントを切り替えずに1つのモデルで扱える
- **R2Vとの併用**: 参照画像用のノード(MiniMaxH3ReferenceToVideo)にキャラクターシートを入れつつ、ControlNet側でモーションを駆動する、という組み合わせが実際に動くことが確認できる非公式のComfyUIカスタムノード([`ComfyUI-H3-FunControl`](https://github.com/wyzborrero/ComfyUI-H3-FunControl))のREADMEで報告されている
- **control strength/scheduleの勘所**: 単純に「0.6〜1.0の範囲で強めに」というよりは、複数のcontrol種類を併用する場合は強度を分散させるのがコツで、READMEには「depth 0.3 + pose 0.7はうまくいくが、両方1.0にすると破綻する」という実測報告がある。またcontrol_end_percentは初期値の1.0のままだと動きが止まりやすく、0.6前後で早めに打ち切る(そこから先はベースのモーションに任せる)と、構図を保ちつつ動きも止まらないという運用ノウハウも共有されている

一方で、3枚以上の静止コマをそのまま時系列に沿って読み込ませる前例は今のところ薄く、コマをフレーム位置ごとに配置した疑似コントロール動画を生成する部分は自作が必要になりそうというのが現時点の見立て。

## 次のアクション候補

- 既存のFun ControlNet UnionをR2Vと組み合わせ、ラフスケッチをCanny/HEDに変換した上で、まず1コマ構成で検証する
- 問題なければ、複数コマをフレーム位置ごとに配置する疑似コントロール動画生成ノードを自作する方向で詰める
