import { test } from "node:test";
import assert from "node:assert/strict";
import { createTextureLog, groupProgress, keyScanDone, keyScanProbe, plural } from "../src/lib/log-groups.js";
import { appendLog, classifyLine, progressPhase } from "../src/lib/progress.js";

/** Replay lines the way offscreen + background do. */
function replay(lines, phase = "textures") {
  const log = [];
  for (const [text, meta] of lines) {
    phase = progressPhase(text, meta, phase);
    const line = classifyLine(text);
    appendLog(log, { kind: line.kind, text: line.text, depth: line.depth, ...meta });
  }
  return { log, phase };
}

test("plural", () => {
  assert.equal(plural(1, "script"), "1 script");
  assert.equal(plural(0, "map"), "0 maps");
  assert.equal(plural(12, "map"), "12 maps");
});

test("key scan: probes fold into one decrypt row that closes with the key", () => {
  const lines = [keyScanProbe("a.js"), keyScanProbe("b.js"), keyScanDone("71c5b342deadbeef", 2)];
  assert.deepEqual(lines[0], ["Extracting decrypt key", { group: "key-scan", detail: "a.js" }]);
  assert.equal(progressPhase(lines[0][0], undefined, "reading"), "decrypting");
  // The closing line keeps the phase; the row keeps the kind of its first line.
  assert.equal(progressPhase(lines[2][0], undefined, "decrypting"), "decrypting");

  const { log, phase } = replay(lines, "reading");
  assert.equal(phase, "decrypting");
  assert.equal(log.length, 1);
  assert.equal(log[0].kind, "decrypt");
  assert.equal(log[0].depth, 0);
  assert.equal(log[0].text, "Decrypt key 71c5b342…");
  assert.equal(log[0].detail, "2 scripts");
  assert.equal(log[0].status, "done");
  assert.equal(log[0].active, false);
});

test("key scan fallback closes as warn and does not spin", () => {
  const [text, meta] = keyScanDone("abcdef0123", 1, "default");
  assert.equal(text, "Decrypt key abcdef01…");
  assert.deepEqual(meta, { group: "key-scan", detail: "1 script · built-in key", status: "warn" });
  const { log } = replay([keyScanProbe("a.js"), [text, meta]]);
  assert.equal(log[0].active, false);
  assert.equal(log[0].status, "warn");
});

test("texture log: interleaved textures merge into one row each under a parent", () => {
  const lines = [];
  const tl = createTextureLog(3, (text, meta) => lines.push([text, meta]));
  const a = tl.start("body.png");
  const b = tl.start("wheel.jpg");
  a.step("descramble start pk=3 5000 B");
  b.step("passthrough");
  a.progress("  descramble 1024x1024 pk=3");
  b.done({ width: 512, height: 512, inBytes: 800, outBytes: 800, fromDescramble: false, pk: null });
  a.step("descramble ok 9000 B");
  a.done({ width: 1024, height: 1024, inBytes: 5000, outBytes: 9000, fromDescramble: true, pk: 3 });
  const c = tl.start("saving.png");
  c.fail("failed: 404");
  tl.finish();

  // No per-texture percentages, no line text leaks into a later phase.
  const { log, phase } = replay(lines);
  assert.equal(phase, "textures");
  assert.equal(log.length, 4);

  const parent = log[0];
  assert.equal(parent.group, "textures");
  assert.equal(parent.text, "Textures");
  assert.equal(parent.detail, "3 maps · 1 descrambled · 1 passthrough · 1 failed");
  assert.equal(parent.status, "done");
  assert.equal(parent.active, false);

  const [rowA, rowB, rowC] = log.slice(1);
  assert.equal(rowA.group, "texture:body.png");
  assert.equal(rowA.parent, "textures");
  assert.equal(rowA.kind, "detail");
  assert.equal(rowA.text, "body.png");
  assert.deepEqual([rowA.width, rowA.height, rowA.inBytes, rowA.outBytes], [1024, 1024, 5000, 9000]);
  assert.equal(rowA.detail, "pk=3");
  assert.equal(rowA.status, "done");
  assert.equal(rowA.count, 5); // fetching, start, descramble, ok, done

  assert.equal(rowB.text, "wheel.jpg");
  assert.deepEqual([rowB.width, rowB.inBytes, rowB.outBytes], [512, 800, 800]);
  assert.equal(rowB.detail, "passthrough");

  assert.equal(rowC.text, "saving.png");
  assert.equal(rowC.status, "error");
  assert.equal(rowC.active, false);
});

test("texture log: parent row only at open, per skip and at finish; progress comes from children", () => {
  const lines = [];
  const tl = createTextureLog(5, (text, meta) => lines.push([text, meta]));
  assert.deepEqual(lines[0], ["Textures", { group: "textures", total: 5 }]);
  const rows = ["a.png", "b.png", "c.png", "d.png"].map((n) => tl.start(n));
  rows[1].done({ width: 64, height: 64, inBytes: 1, outBytes: 1, fromDescramble: false });
  tl.skip();
  assert.deepEqual(lines.at(-1), ["Textures", { group: "textures", skipped: 1 }]);
  assert.equal(lines.filter(([, m]) => m.group === "textures").length, 2);

  const { log } = replay(lines);
  const [parent, ...children] = log;
  const { finished, total, inFlight } = groupProgress(parent, children);
  assert.equal(finished, 2);
  assert.equal(total, 5);
  assert.deepEqual(inFlight.map((c) => c.text), ["a.png", "c.png", "d.png"]);
});

test("texture log: a mid-flight warning sends no status", () => {
  const lines = [];
  const tl = createTextureLog(1, (text, meta) => lines.push([text, meta]));
  tl.start("x.jpg").step("descramble failed: bad pk", "warn");
  assert.deepEqual(lines.at(-1), ["x.jpg", { group: "texture:x.jpg", parent: "textures", detail: "descramble failed: bad pk" }]);
  assert.equal(replay(lines).log[1].active, true);
});

test("texture log: failed descramble keeps warn on the closed row", () => {
  const lines = [];
  const tl = createTextureLog(1, (text, meta) => lines.push([text, meta]));
  const row = tl.start("x.jpg");
  row.step("descramble failed: bad pk", "warn");
  row.done({ width: 256, height: 256, inBytes: 10, outBytes: 10, fromDescramble: false, pk: 9 });
  const { log } = replay(lines);
  assert.equal(log[1].status, "warn");
  assert.equal(log[1].active, false);
  assert.equal(log[1].detail, "descramble failed: bad pk");
});

test("texture log: repeated names get distinct groups", () => {
  const lines = [];
  const tl = createTextureLog(2, (text, meta) => lines.push([text, meta]));
  tl.start("dup.png");
  tl.start("dup.png");
  const groups = new Set(lines.filter(([, m]) => m.parent).map(([, m]) => m.group));
  assert.deepEqual([...groups], ["texture:dup.png", "texture:dup.png#2"]);
});

test("texture log tolerates a missing onProgress", () => {
  const tl = createTextureLog(1, undefined);
  tl.start("a.png").done({ width: 1, height: 1, inBytes: 1, outBytes: 1, fromDescramble: false });
  tl.finish();
  assert.equal(tl.counts.passthrough, 1);
});
