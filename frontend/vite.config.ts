import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Accio Studio",
        short_name: "Accio",
        description: "Image generation and editing on your local ComfyUI.",
        display: "standalone",
        start_url: "/",
        background_color: "#0b0a0f",
        theme_color: "#0b0a0f",
      },
      workbox: {
        // App shell only: never cache the API, WebSocket traffic or result images.
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
      },
    }),
  ],
  server: {
    proxy: { "/api": { target: "http://localhost:7862", ws: true } },
  },
  build: { target: "es2022" },
});
