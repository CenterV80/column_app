// Registry of published content. Add a new entry here to list another app
// or article — no other changes needed as long as it lives under its own
// folder with its own index.html. `category` must match an id in
// categories.js so the item shows up on the right category page.
const APPS = [
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
];
