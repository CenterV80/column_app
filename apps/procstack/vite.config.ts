import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages はリポジトリ配下のサブパスにデプロイされるため、
// index.html からの相対パスでアセットを解決する。
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "procstack",
        short_name: "procstack",
        description: "スマホ向けプロシージャルモデラー",
        start_url: "./",
        display: "standalone",
        background_color: "#15171C",
        theme_color: "#15171C",
        icons: [
          { src: "icon.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
          { src: "icon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
        ],
      },
    }),
  ],
});
