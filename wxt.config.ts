import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-svelte"],
  webExt: { disabled: true },
  manifest: {
    name: "Sketchfab to glTF",
    description:
      "Download public Sketchfab models as GLB or glTF. One click, saves in the background.",
    // 140: the popup's view transitions need nested `view-transition-group`.
    minimum_chrome_version: "140",
    // unlimitedStorage: history is uncapped; a collection batch can pass the 10 MB quota.
    permissions: ["downloads", "storage", "unlimitedStorage", "offscreen"],
    host_permissions: [
      "https://sketchfab.com/*",
      "https://www.sketchfab.com/*",
      "https://media.sketchfab.com/*",
      "https://static.sketchfab.com/*",
    ],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    action: { default_title: "Sketchfab to glTF" },
  },
});
