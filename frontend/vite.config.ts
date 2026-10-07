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
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "Accio Studio",
        short_name: "Accio",
        description: "Create and edit images with your own computer's graphics card.",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        scope: "/",
        background_color: "#0b0a0f",
        theme_color: "#0b0a0f",
        categories: ["graphics", "photo"],
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "/monochrome-512.png", sizes: "512x512", type: "image/png", purpose: "monochrome" },
        ],
      },
      workbox: {
        // App shell only: never cache the API, WebSocket traffic or result images.
        navigateFallbackDenylist: [/^\/api\//, /^\/dev/],
        globPatterns: ["**/*.{js,css,html,svg,woff2,png}"],
      },
    }),
  ],
  server: {
    proxy: { "/api": { target: "http://localhost:7862", ws: true } },
  },
  build: { target: "es2022" },
});
