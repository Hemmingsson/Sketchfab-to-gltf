import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBytes, formatBytesRange, humanizeLogText, logTone } from "../src/lib/log-display.js";

test("formatBytes picks B / KB / MB", () => {
  assert.equal(formatBytes(222), "222 B");
  assert.equal(formatBytes(6500), "6.3 KB");
  assert.equal(formatBytes(4859221), "4.6 MB");
});

test("formatBytesRange writes a shared unit once", () => {
  assert.equal(formatBytesRange(4859221, 5242880), "4.6 → 5.0 MB");
  assert.equal(formatBytesRange(800, 800), "800 → 800 B");
  assert.equal(formatBytesRange(900, 1250), "900 B → 1.2 KB");
});

test("humanizeLogText rewrites raw byte counts only", () => {
  assert.equal(
    humanizeLogText("Decrypting file.binz (266937 bytes)…"),
    "Decrypting file.binz (260.7 KB)…",
  );
  assert.equal(humanizeLogText("→ file.osgjs (4859221 bytes)"), "→ file.osgjs (4.6 MB)");
  assert.equal(humanizeLogText("descramble ok 6500 B"), "descramble ok 6.3 KB");
  assert.equal(humanizeLogText("1 byte 2 bytes"), "1 byte 2 B");
  assert.equal(humanizeLogText("diter.b length: 524"), "diter.b length: 524");
  assert.equal(humanizeLogText("Texture 3/35 Body_B.png"), "Texture 3/35 Body_B.png");
  assert.equal(humanizeLogText("12 Bones"), "12 Bones");
});

test("logTone classifies warnings and noise", () => {
  assert.equal(logTone("NOTE: 1 texture(s) look unusually small…"), "warn");
  assert.equal(logTone("WARN: missing normal map"), "warn");
  assert.equal(logTone("Warning: fallback UVs"), "warn");
  assert.equal(logTone("→ file.osgjs (4859221 bytes)"), "dim");
  assert.equal(logTone("diter.b length: 524"), "dim");
  assert.equal(logTone("Reading key from main.js pk=3"), "dim");
  assert.equal(logTone("WASM loaded (248 KB)"), "dim");
  assert.equal(logTone("Converting to glTF…"), "normal");
  assert.equal(logTone("Downloading textures…"), "normal");
});
