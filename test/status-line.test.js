import { test } from "node:test";
import assert from "node:assert/strict";
import { appendLog } from "../src/lib/progress.js";
import { createTextureLog, keyScanDone, keyScanProbe } from "../src/lib/log-groups.js";
import { groupActivity, liveStatusLine, middleTruncate, pickActiveGroup } from "../src/lib/status-line.js";

/** Feed onProgress(text, meta) lines into a log the way background.ts does. */
function logFrom(run) {
  const log = [];
  const emit = (text, meta = {}) => appendLog(log, { kind: "detail", text, ...meta });
  run(emit);
  return log;
}

test("middleTruncate keeps short text and the extension", () => {
  assert.equal(middleTruncate("Body_B.png"), "Body_B.png");
  assert.equal(middleTruncate("gltf_embedded_12.png", 16), "gltf_emb…_12.png");
  assert.equal(middleTruncate("d723d800aa11bb22cc33-v2.js", 15), "d723d800…-v2.js");
  const long = middleTruncate("gltf_embedded_12_carbon_fibre_normal.png");
  assert.equal(long.length, 24);
  assert.ok(long.endsWith(".png"));
  assert.ok(long.includes("…"));
  assert.equal(middleTruncate("x".repeat(30)).length, 24);
});

test("pickActiveGroup takes the newest open top-level group", () => {
  const log = [
    { text: "Reading public viewer…" },
    { group: "key-scan", active: false, text: "Decrypt key 71c5b342…" },
    { group: "textures", active: true, text: "Textures", total: 35 },
    { group: "texture:a", parent: "textures", active: true, text: "a" },
    { text: "plain line", active: true },
  ];
  assert.equal(pickActiveGroup(log)?.group, "textures");
  assert.equal(pickActiveGroup([{ group: "key-scan", active: false }]), undefined);
  assert.equal(pickActiveGroup([]), undefined);
  assert.equal(pickActiveGroup(undefined), undefined);
});

test("key scan: probe count plus current script", () => {
  const log = logFrom((emit) => {
    for (let i = 0; i < 14; i++) emit(...keyScanProbe(`script-${i}.js`));
    emit(...keyScanProbe("d723d800aa11bb22cc33dd44ee55-v2.js"));
  });
  assert.equal(liveStatusLine(log, "Decrypting", 30.6), "Decrypt key · 15 scripts · d723d800aa11bb22…5-v2.js · 31%");
  assert.equal(groupActivity({ group: "key-scan", text: "Extracting decrypt key", count: 1, detail: "a.js" }), "Decrypt key · 1 script · a.js");
});

test("closed key scan falls back to the phase label", () => {
  const log = logFrom((emit) => {
    emit(...keyScanProbe("a.js"));
    emit(...keyScanDone("71c5b342deadbeef", 1));
  });
  assert.equal(liveStatusLine(log, "Decrypting", 40), "Decrypting · 40%");
});

test("textures: parent counter plus first in-flight name, children ignored", () => {
  const log = logFrom((emit) => {
    emit(...keyScanProbe("a.js"));
    emit(...keyScanDone("71c5b342deadbeef", 1));
    const tex = createTextureLog(35, emit);
    for (let i = 0; i < 22; i++) tex.skip();
    tex.start("Body_B.png").done({ width: 1, height: 1, inBytes: 1, outBytes: 1, fromDescramble: true, pk: 1 });
    tex.start("gltf_embedded_12.png").step("descrambling");
    tex.start("gltf_embedded_13.png");
  });
  assert.equal(liveStatusLine(log, "Textures", 63.7), "Textures 23/35 · gltf_embedded_12.png · 64%");
});

test("textures with nothing in flight show just the counter", () => {
  const log = logFrom((emit) => createTextureLog(35, emit));
  assert.equal(liveStatusLine(log, "Textures", 50), "Textures 0/35 · 50%");
});

test("finished textures and no open group use phase label", () => {
  const log = logFrom((emit) => {
    const tex = createTextureLog(1, emit);
    tex.skip();
    tex.finish();
  });
  assert.equal(liveStatusLine(log, "Converting", 88.4), "Converting · 88%");
  assert.equal(liveStatusLine([], "Reading viewer", 3), "Reading viewer · 3%");
});

test("other open groups show text and truncated detail", () => {
  const log = [];
  appendLog(log, { kind: "detail", text: "Packing ORM", group: "orm", detail: "roughness_metallic_occlusion_body.png" });
  assert.equal(liveStatusLine(log, "Packing ORM", 70), "Packing ORM · roughness_metall…ody.png · 70%");
  appendLog(log, { kind: "detail", text: "Packing ORM", group: "orm", status: "done" });
  assert.equal(liveStatusLine(log, "Packing ORM", 71), "Packing ORM · 71%");
});
