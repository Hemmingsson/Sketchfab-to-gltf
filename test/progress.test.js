import { test } from "node:test";
import assert from "node:assert/strict";
import { LOG_CAP, appendLog, classifyLine, closeOpenGroups, progressPhase, settleLog } from "../src/lib/progress.js";

test("progressPhase maps known progress lines and keeps previous phase for unknown lines", () => {
  assert.equal(progressPhase("Reading public viewer", undefined, "queued"), "reading");
  assert.equal(progressPhase("Downloading file.binz", undefined, "reading"), "decrypting");
  assert.equal(progressPhase("Texture 3/12: a.png (1024x1024)", undefined, "decrypting"), "textures");
  assert.equal(progressPhase("Packing ORM maps...", undefined, "textures"), "packing");
  assert.equal(progressPhase("Converting osgjs to glTF (GLB)...", undefined, "packing"), "converting");
  assert.equal(progressPhase("Building ZIP (3 entries)...", undefined, "converting"), "zipping");
  assert.equal(progressPhase("ZIP ready", undefined, "zipping"), "saving");
  assert.equal(progressPhase("Unrecognized progress line", undefined, "textures"), "textures");
});

test("progressPhase ignores child rows so a file name cannot jump the phase", () => {
  assert.equal(progressPhase("saving.png", { group: "texture:saving.png", parent: "textures" }, "textures"), "textures");
  assert.equal(progressPhase("Packing ORM maps...", undefined, "textures"), "packing");
  assert.equal(progressPhase("Extracting decrypt key", { group: "key-scan" }, "reading"), "decrypting");
});

test("classifyLine maps header lines at depth 0", () => {
  const cases = [
    ["ERROR: x", "error"],
    ["Reading public viewer...", "reading"],
    ["Loading WASM decrypt module...", "decrypt"],
    ["Downloading textures...", "texture"],
    ["Downloading file.binz...", "download"],
    ["Packing ORM maps...", "pack"],
    ["Converting osgjs -> glTF (GLB)...", "convert"],
    ["Building ZIP (3 entries)...", "zip"],
  ];

  for (const [line, kind] of cases) {
    assert.deepEqual(classifyLine(line), { kind, depth: 0, text: line });
  }
});

test("classifyLine nests indented and unmatched lines as trimmed details", () => {
  assert.deepEqual(classifyLine("  -> file.osgjs (12 bytes)"), {
    kind: "detail",
    depth: 1,
    text: "-> file.osgjs (12 bytes)",
  });
  assert.deepEqual(classifyLine("Model: X (by Y)"), {
    kind: "detail",
    depth: 1,
    text: "Model: X (by Y)",
  });
  assert.deepEqual(classifyLine("Texture 3/12: a.png (1024x1024)"), {
    kind: "detail",
    depth: 1,
    text: "Texture 3/12: a.png (1024x1024)",
  });
});

test("appendLog clears older actives, marks nested entries done, and creates unique ids", () => {
  const log = [];

  appendLog(log, { kind: "reading", text: "Reading public viewer" });
  appendLog(log, { kind: "detail", text: "UID: abc", depth: 1 });
  appendLog(log, { kind: "decrypt", text: "Loading WASM decrypt module" });

  assert.equal(log.length, 3);
  assert.equal(log[0].active, false);
  assert.equal(log[0].done, undefined);
  assert.equal(log[1].active, false);
  assert.equal(log[1].done, true);
  assert.equal(log[2].active, true);
  assert.equal(log[2].depth, 0);
  assert.equal(new Set(log.map((entry) => entry.id)).size, log.length);
});

test("appendLog honors explicit inactive entries", () => {
  const log = [];
  appendLog(log, { kind: "done", text: "Saved model.glb" }, false);

  assert.equal(log[0].active, false);
});

test("appendLog trims oldest entries to LOG_CAP", () => {
  const log = [];

  for (let i = 0; i < LOG_CAP + 2; i++) {
    appendLog(log, { kind: "detail", text: `line ${i}`, depth: 1 });
  }

  assert.equal(log.length, LOG_CAP);
  assert.equal(log[0].text, "line 2");
  assert.equal(log[LOG_CAP - 1].text, `line ${LOG_CAP + 1}`);
  assert.equal(new Set(log.map((entry) => entry.id)).size, LOG_CAP);
});

test("settleLog clears active entries and marks nested entries done", () => {
  const log = [];
  appendLog(log, { kind: "reading", text: "Reading public viewer" });
  appendLog(log, { kind: "detail", text: "UID: abc", depth: 1 });

  settleLog(log);

  assert.equal(log[0].active, false);
  assert.equal(log[0].done, undefined);
  assert.equal(log[1].active, false);
  assert.equal(log[1].done, true);
});

test("appendLog upserts grouped lines in place and counts them", () => {
  const log = [];
  appendLog(log, { kind: "decrypt", text: "Extracting decrypt key" });
  const first = appendLog(log, { kind: "detail", text: "Reading key from a.js", depth: 1, group: "key" });
  const { id, at } = first;

  assert.equal(first.count, 1);
  assert.equal(first.active, true);

  appendLog(log, { kind: "detail", text: "Reading key from b.js", depth: 1, group: "key", detail: "b.js" });
  appendLog(log, { kind: "detail", text: "Reading key from c.js", depth: 1, group: "key" });

  assert.equal(log.length, 2);
  assert.equal(log[1], first);
  assert.equal(log[1].id, id);
  assert.equal(log[1].at, at);
  assert.equal(log[1].text, "Reading key from c.js");
  assert.equal(log[1].detail, "b.js");
  assert.equal(log[1].count, 3);
  assert.equal(log[1].active, true);
});

test("grouped upserts keep position while other lines append after them", () => {
  const log = [];
  appendLog(log, { kind: "texture", text: "Downloading textures" });
  appendLog(log, { kind: "detail", text: "a.png start", depth: 1, group: "texture:a", parent: "textures" });
  appendLog(log, { kind: "detail", text: "b.png start", depth: 1, group: "texture:b", parent: "textures" });
  appendLog(log, { kind: "detail", text: "a.png ok", depth: 1, group: "texture:a", status: "done" });
  appendLog(log, { kind: "detail", text: "unrelated", depth: 1 });

  assert.deepEqual(
    log.map((entry) => entry.text),
    ["Downloading textures", "a.png ok", "b.png start", "unrelated"],
  );
  assert.equal(log[1].parent, "textures");
  assert.equal(log[1].count, 2);
  assert.equal(log[1].status, "done");
  assert.equal(log[1].active, false);
  assert.equal(log[1].done, true);
  assert.equal(log[2].parent, "textures");
  assert.equal(log[2].active, true);
  assert.equal(new Set(log.map((entry) => entry.id)).size, log.length);
});

test("any status closes a grouped entry; only done marks it done", () => {
  const log = [];
  appendLog(log, { kind: "error", text: "boom", group: "g", status: "error" });
  assert.equal(log[0].active, false);
  appendLog(log, { kind: "detail", text: "warn", group: "w" });
  assert.equal(log[1].active, true);
  appendLog(log, { kind: "detail", text: "warn", group: "w", status: "warn" });
  assert.equal(log[1].active, false);
  assert.equal(log[1].done, undefined);
  assert.equal(log[1].count, 2);
});

test("grouped upserts keep kind and depth of the first line and store optional fields", () => {
  const log = [];
  appendLog(log, { kind: "decrypt", text: "Extracting decrypt key", group: "key-scan", detail: "a.js" });
  appendLog(log, { kind: "detail", depth: 1, text: "Decrypt key 71c5b342…", group: "key-scan", detail: "1 script", status: "done" });
  assert.equal(log[0].kind, "decrypt");
  assert.equal(log[0].depth, 0);
  assert.equal(log[0].text, "Decrypt key 71c5b342…");
  assert.equal(log[0].done, true);

  appendLog(log, { kind: "detail", depth: 1, text: "a.png", group: "texture:a", parent: "textures", detail: "fetching" });
  appendLog(log, { kind: "detail", depth: 1, text: "a.png", group: "texture:a", width: 64, height: 32, inBytes: 10, outBytes: 20, total: undefined });
  assert.deepEqual(
    [log[1].width, log[1].height, log[1].inBytes, log[1].outBytes, "total" in log[1], log[1].detail],
    [64, 32, 10, 20, false, "fetching"],
  );
});

test("non-grouped entries never merge and carry no count", () => {
  const log = [];
  appendLog(log, { kind: "detail", text: "same", depth: 1 });
  appendLog(log, { kind: "detail", text: "same", depth: 1 });
  assert.equal(log.length, 2);
  assert.equal(log[0].count, undefined);
  assert.equal(log[0].group, undefined);
});

test("settleLog leaves open grouped entries active", () => {
  const log = [];
  appendLog(log, { kind: "detail", text: "Textures 1/3", depth: 1, group: "textures" });
  appendLog(log, { kind: "detail", text: "Packed ORM", depth: 1 });
  appendLog(log, { kind: "detail", text: "Next", depth: 1 });

  assert.equal(log[0].active, true);
  assert.equal(log[0].done, undefined);
  assert.equal(log[1].active, false);
  assert.equal(log[1].done, true);
  assert.equal(log[2].active, true);

  settleLog(log);
  assert.equal(log[0].active, true);
  assert.equal(log[2].active, false);
});

test("closeOpenGroups closes only still-active groups", () => {
  const log = [];
  appendLog(log, { kind: "detail", text: "a", group: "texture:a", status: "done" });
  appendLog(log, { kind: "detail", text: "b", group: "texture:b" });
  appendLog(log, { kind: "detail", text: "c", group: "texture:c", status: "error" });

  closeOpenGroups(log, "error");

  assert.deepEqual(
    log.map((entry) => [entry.status, entry.active]),
    [["done", false], ["error", false], ["error", false]],
  );
});

test("grouped upserts do not grow the log and the cap still applies", () => {
  const log = [];
  for (let i = 0; i < LOG_CAP * 2; i++) {
    appendLog(log, { kind: "detail", text: `key ${i}`, depth: 1, group: "key" });
  }
  assert.equal(log.length, 1);
  assert.equal(log[0].count, LOG_CAP * 2);

  for (let i = 0; i < LOG_CAP; i++) {
    appendLog(log, { kind: "detail", text: `line ${i}`, depth: 1 });
  }
  assert.equal(log.length, LOG_CAP);
  assert.equal(log[0].text, "line 0");

  // Trimmed group starts again as a fresh entry.
  appendLog(log, { kind: "detail", text: "key again", depth: 1, group: "key" });
  assert.equal(log.length, LOG_CAP);
  assert.equal(log.at(-1).count, 1);
  assert.equal(new Set(log.map((entry) => entry.id)).size, LOG_CAP);
});
