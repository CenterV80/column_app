// Registry of topic categories shown on the top hub page. Add a new entry
// here, then tag items in apps.js with the matching category id, and add
// categories/<id>/index.html to list them.
const CATEGORIES = [
  {
    id: "articles",
    name: "AI記事まとめ",
    description: "ローカルAIまわりの気になるニュースをまとめています。",
    path: "articles.html",
    icon: "📚",
  },
  {
    id: "github",
    name: "GitHub 使い方",
    description: "GitHubの基本用語からデプロイ方法まで、初心者向けにまとめています。",
    path: "categories/github/",
    icon: "🐙",
  },
  {
    id: "python",
    name: "Python",
    description: "Pythonまわりのコマンドや使い方を初心者向けにまとめています。",
    path: "categories/python/",
    icon: "🐍",
  },
  {
    id: "ltx",
    name: "AI動画",
    description: "動画生成AI「LTX」シリーズのしくみや、生成AIまわりの用語を解説する記事です。",
    path: "categories/ltx/",
    icon: "🎬",
  },
  {
    id: "mini-apps",
    name: "ミニアプリ",
    description: "ブラウザだけで動く、ちょっとしたツール・ミニアプリ集です。",
    path: "categories/mini-apps/",
    icon: "🧰",
  },
  {
    id: "comfyui",
    name: "ComfyUI",
    description: "ComfyUIを使った画像・動画生成ワークフローや、関連ツールの技術仕様をまとめています。",
    path: "categories/comfyui/",
    icon: "🧵",
  },
  {
    id: "ue",
    name: "UE",
    description: "Unreal Engineのマテリアルまわりの小技・Tipsをまとめています。",
    path: "categories/ue/",
    icon: "🧱",
  },
  {
    id: "houdini",
    name: "Houdini",
    description: "Houdiniのネットワーク構築・HDA(Digital Asset)まわりの小技をまとめています。",
    path: "categories/houdini/",
    icon: "🎛️",
  },
  {
    id: "ai-coding",
    name: "AIコーディング",
    description: "GitHub CopilotやClaude CodeなどAIコーディングツールと効率よく付き合うための運用ルール・Tipsをまとめています。",
    path: "categories/ai-coding/",
    icon: "🤖",
  },
];
