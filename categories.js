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
    name: "LTX",
    description: "動画生成AI「LTX」シリーズのしくみを解説する記事です。",
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
];
