import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatRawLog,
  formatRawLogLine,
  isLogRowVisible,
  parseLogView,
} from "../src/lib/log-view.js";

test("parseLogView defaults to summary", () => {
  assert.equal(parseLogView("raw"), "raw");
  assert.equal(parseLogView("summary"), "summary");
  assert.equal(parseLogView(null), "summary");
  assert.equal(parseLogView(undefined), "summary");
  assert.equal(parseLogView("RAW"), "summary");
});

test("summary hides dim lines only", () => {
  assert.equal(isLogRowVisible({ text: "→ file.osgjs (4859221 bytes)" }, "summary"), false);
  assert.equal(isLogRowVisible({ text: "WASM loaded" }, "summary"), false);
  assert.equal(isLogRowVisible({ text: "Reading viewer" }, "summary"), true);
  assert.equal(isLogRowVisible({ text: "NOTE: 1 texture looks unusually small" }, "summary"), true);
});

test("summary keeps grouped rows and warn/error rows even with dim text", () => {
  assert.equal(isLogRowVisible({ text: "→ key scan", group: "key" }, "summary"), true);
  assert.equal(isLogRowVisible({ text: "→ failed", status: "warn" }, "summary"), true);
  assert.equal(isLogRowVisible({ text: "→ failed", status: "error" }, "summary"), true);
  assert.equal(isLogRowVisible({ text: "→ boom", kind: "error" }, "summary"), true);
});

test("raw shows everything", () => {
  assert.equal(isLogRowVisible({ text: "→ file.osgjs" }, "raw"), true);
  assert.equal(isLogRowVisible({ text: "WASM loaded" }, "raw"), true);
});

test("formatRawLogLine keeps stored text and plain suffixes", () => {
  assert.equal(formatRawLogLine({ text: "Decrypting file.binz (266937 bytes)…" }), "Decrypting file.binz (266937 bytes)…");
  assert.equal(formatRawLogLine({ text: "UID: abc", depth: 1 }), "  UID: abc");
  assert.equal(
    formatRawLogLine({
      text: "a.png",
      depth: 1,
      detail: "passthrough",
      status: "done",
      width: 64,
      height: 32,
      inBytes: 10,
      outBytes: 20,
      count: 3,
    }),
    "  a.png  passthrough  done  64x32  10 → 20 bytes  ×3"
  );
});

test("formatRawLog joins flat entries", () => {
  assert.equal(
    formatRawLog([{ text: "Reading" }, { text: "detail", depth: 1 }]),
    "Reading\n  detail"
  );
});
