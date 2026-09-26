import { test } from "node:test";
import assert from "node:assert/strict";
import { descrambleRgbaAsync, offsetFromPk } from "../src/lib/descramble.js";

test("offsetFromPk is deterministic and wraps", () => {
  assert.equal(offsetFromPk(10, 64, 64), offsetFromPk(10, 64, 64));
  const off = offsetFromPk(999999, 64, 64);
  assert.ok(off <= 0);
  assert.ok(Math.abs(off) < 64 * 64);
});

test("offsetFromPk empty size is 0", () => {
  assert.equal(offsetFromPk(1, 0, 64), 0);
});

function makeRgba(w, h) {
  const src = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    src[i * 4] = i % 256;
    src[i * 4 + 1] = (i * 3) % 256;
    src[i * 4 + 2] = (i * 7) % 256;
    src[i * 4 + 3] = 255;
  }
  return src;
}

test("descrambleRgbaAsync keeps size and is deterministic", async () => {
  const w = 64;
  const h = 64;
  const src = makeRgba(w, h);
  const a = await descrambleRgbaAsync(src, w, h, 12345, true);
  const b = await descrambleRgbaAsync(src, w, h, 12345, true);
  assert.equal(a.length, w * h * 4);
  assert.deepEqual(a, b);
  let red = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] === 255 && a[i + 1] === 0 && a[i + 2] === 0) red++;
  }
  assert.ok(red < (w * h) / 2, "valid pk should not paint mostly error-red");
});

test("descrambleRgbaAsync accepts sizes that are not multiples of 8", async () => {
  const w = 400;
  const h = 401;
  const src = makeRgba(w, h);
  const out = await descrambleRgbaAsync(src, w, h, 160765, true);
  assert.equal(out.length, w * h * 4);
});

test("descrambleRgbaAsync covers every row across yield slices", async () => {
  const w = 67;
  const h = 530;
  const src = makeRgba(w, h);
  const a = await descrambleRgbaAsync(src, w, h, 160765, true);
  const b = await descrambleRgbaAsync(src, w, h, 160765, true);
  assert.equal(a.length, w * h * 4);
  assert.deepEqual(a, b);
  // Rows past the first slice are written, not left as the zeroed buffer.
  assert.ok(a.subarray(300 * w * 4).some((v) => v !== 0));
});
