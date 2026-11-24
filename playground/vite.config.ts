import { fileURLToPath } from "node:url";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  root: page("."),
  plugins: [svelte({ configFile: false, preprocess: [vitePreprocess()] })],
  build: {
    // Theatre Studio is a prebundled, dev-only editor. Keep a 1 MB budget for
    // this playground; the shipped extension retains Vite's default budget.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: { main: page("index.html"), tuner: page("tuner.html") },
    },
  },
});
