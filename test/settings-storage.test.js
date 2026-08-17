import test from "node:test";
import assert from "node:assert/strict";

// Minimal in-memory chrome.storage.local fake so the async prefs paths
// (loadPrefs / savePrefs / setLang / setDevMode) can be exercised in Node.
function installChromeFake() {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return { ...store };
          const list = typeof keys === "string" ? [keys] : keys;
          const out = {};
          for (const k of list) if (k in store) out[k] = store[k];
          return out;
        },
        async set(obj) {
          Object.assign(store, obj);
        },
      },
      session: { async set() {} },
    },
  };
  return store;
}

test("savePrefs round-trips through loadPrefs", async () => {
  installChromeFake();
  const { savePrefs, loadPrefs } = await import("../lib/settings.js");
  await savePrefs({ theme: "dark", packMode: "glb", maxTextureEdge: 2048 });
  const p = await loadPrefs();
  assert.equal(p.theme, "dark");
  assert.equal(p.packMode, "glb");
  assert.equal(p.maxTextureEdge, 2048);
});

test("setLang persists into the canonical prefs blob (no divergence)", async () => {
  const store = installChromeFake();
  const { setLang } = await import("../lib/i18n.js");
  const { loadPrefs } = await import("../lib/settings.js");
  await setLang("ru");
  // Both the canonical blob and the mirror key must agree.
  assert.equal((await loadPrefs()).lang, "ru");
  assert.equal(store.sf_prefs.lang, "ru");
  assert.equal(store.sf_lang, "ru");
});

test("setDevMode persists into the canonical prefs blob", async () => {
  const store = installChromeFake();
  const { setDevMode } = await import("../lib/devlog.js");
  const { loadPrefs } = await import("../lib/settings.js");
  await setDevMode(true);
  assert.equal((await loadPrefs()).devMode, true);
  assert.equal(store.sf_prefs.devMode, true);
});

test("loadPrefs migrates from legacy mirror keys when no blob exists", async () => {
  const store = installChromeFake();
  store.sf_lang = "ru";
  store.sf_download_textures = true;
  const { loadPrefs } = await import("../lib/settings.js");
  const p = await loadPrefs();
  assert.equal(p.lang, "ru");
  assert.equal(p.textures, true);
});
