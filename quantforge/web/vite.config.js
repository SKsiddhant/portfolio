import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" lets the same build run on GitHub Pages (/portfolio/quantforge/demo/) and from Flask (/)
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "../demo", emptyOutDir: true, chunkSizeWarningLimit: 700 },
  worker: { format: "es" },
  server: { proxy: { "/api": "http://127.0.0.1:5000" } },
});
