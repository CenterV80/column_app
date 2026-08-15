// Registry of published content. Add a new entry here to list another app
// or article — no other changes needed as long as it lives under its own
// folder with its own index.html. `category` must match an id in
// categories.js so the item shows up on the right category page.
const APPS = [
  {
    name: "GitHub用語辞典",
    description: "Repository・Commit・Push・Pullなど、GitHub初心者がつまずきやすい用語をやさしく解説します。",
    path: "github-glossary.html",
    icon: "📖",
    category: "github",
  },
  {
    name: "GitHubの一般的なデプロイ方法",
    description: "GitHub Pages・GitHub Actions・外部ホスティングサービスなど、代表的なデプロイ方法を初心者向けに紹介します。",
    path: "github-deploy-guide.html",
    icon: "🚢",
    category: "github",
  },
  {
    name: "pip コマンド一覧",
    description: "install・uninstall・list・freezeなど、Pythonのパッケージ管理でよく使うpipコマンドをまとめました。",
    path: "pip-commands.html",
    icon: "📦",
    category: "python",
  },
  {
    name: "関数電卓",
    description: "Desmos風のグラフ電卓。複数の数式を色分けして描画し、パン・ズームで自由に表示範囲を変えられます。",
    path: "apps/graph-calculator/",
    icon: "📈",
    category: "mini-apps",
  },
  {
    name: "動画AI LTX-2.3のしくみ入門",
    description: "latent・conditioning・guide・IC-LoRAといったキーワードから、動画生成AIのしくみを初心者向けに図解で解説します。",
    path: "apps/ltx2-video-ai-guide/",
    icon: "🎬",
    category: "ltx",
  },
  {
    name: "生成AI用語",
    description: "蒸留・量子化など、画像・動画生成AIの記事でよく見かける用語をやさしく解説します。",
    path: "generative-ai-glossary.html",
    icon: "🧠",
    category: "ltx",
  },
  {
    name: "画像生成AIパイプライン解説",
    description: "CLIP・VAE・U-Netの役割と関係、データフローの流れを図解で整理します。",
    path: "image-ai-pipeline.html",
    icon: "🖼️",
    category: "ltx",
  },
  {
    name: "HLSL マテリアルエディタ",
    description: "UEのCustomノード風にHLSLを書くと、球やキューブにリアルタイム反映されます。ライトベクターなどの組み込み変数とパラメータ調整つき。",
    path: "apps/hlsl-material-editor/",
    icon: "🎨",
    category: "mini-apps",
  },
  {
    name: "8ビット シューティングゲーム",
    description: "懐かしのドット絵スタイル。敵を撃ってスコアを稼ぎましょう。矢印キーで移動、スペースで射撃。",
    path: "apps/8bit-shooting-game/",
    icon: "🎮",
    category: "mini-apps",
  },
  {
    name: "ローカルLLMチャット",
    description: "ローカル実行のLLM（OllamaやLM Studio等）と会話するシンプルなチャットアプリ。TinyLlamaやPhiなどの軽量モデルでお試しください。",
    path: "apps/local-llm-chat/",
    icon: "🤖",
    category: "mini-apps",
  },
  {
    name: "LTXプロンプトジェネレーター",
    description: "日本語で入力するだけで、LTX-2.3/2.5の公式ガイドに沿った英語プロンプトをブラウザ内AI（WebLLM）が組み立てます。サーバー・APIキー不要。",
    path: "apps/ltx-prompt-generator/",
    icon: "✍️",
    category: "ltx",
  },
  {
    name: "動画生成用タイムラインWeb UI 技術仕様書",
    description: "ComfyUIを実行エンジンとして使い、タイムラインUIを備えた独自Webフロントエンドを構築するための技術仕様書です。",
    path: "apps/comfyui-timeline-webui-spec/",
    icon: "🎞️",
    category: "comfyui",
  },
];
