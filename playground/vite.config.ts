import { fileURLToPath } from "node:url";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  root: page("."),
  plugins: [svelte({ configFile: false, preprocess: [vitePreprocess()] })],
  build: {
    rollupOptions: {
      input: { main: page("index.html"), tuner: page("tuner.html") },
    },
  },
});
