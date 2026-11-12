import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BASE_PATH is the folder the site is served from: "/" at home, "/<repo>/" on GitHub Pages
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
  server: { host: "127.0.0.1", port: 5327, strictPort: true, allowedHosts: true },
  preview: { host: "127.0.0.1", port: 5328, strictPort: true, allowedHosts: true },
});
