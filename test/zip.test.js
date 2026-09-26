import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { buildZip, crc32 } from "../src/lib/zip.js";

const u16le = (b, o) => b[o] | (b[o + 1] << 8);
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

test("buildZip writes PK signature and deflates when smaller", async () => {
  const raw = new TextEncoder().encode("hello ".repeat(400));
  const zip = await buildZip([{ name: "a.txt", data: raw }]);
  assert.equal(zip[0], 0x50);
  assert.equal(zip[1], 0x4b);
  assert.equal(zip[2], 0x03);
  assert.equal(zip[3], 0x04);
  const method = u16le(zip, 8);
  const nameLen = u16le(zip, 26);
  const comp = u32le(zip, 18);
  const uncomp = u32le(zip, 22);
  assert.equal(uncomp, raw.length);
  const data = zip.subarray(30 + nameLen, 30 + nameLen + comp);
  if (method === 8) {
    const out = inflateRawSync(data);
    assert.deepEqual(new Uint8Array(out), raw);
  } else {
    assert.deepEqual(data, raw);
  }
  assert.equal(crc32(raw) >>> 0, crc32(raw) >>> 0);
});

test("buildZip accepts string file data", async () => {
  const zip = await buildZip([{ name: "readme.txt", data: "hello zip" }]);
  assert.equal(zip[0], 0x50);
  assert.equal(zip[1], 0x4b);
  assert.equal(u32le(zip, 22), "hello zip".length);
});

test("buildZip keeps entry order with overlapping deflates", async () => {
  const names = ["big.bin", "small.txt", "mid.bin", "tiny.txt"];
  const sizes = [200_000, 10, 50_000, 1];
  const files = names.map((name, i) => ({ name, data: new Uint8Array(sizes[i]).fill(i + 1) }));
  const zip = await buildZip(files);
  const seen = [];
  let o = 0;
  while (u32le(zip, o) === 0x04034b50) {
    const comp = u32le(zip, o + 18);
    const nameLen = u16le(zip, o + 26);
    seen.push(new TextDecoder().decode(zip.subarray(o + 30, o + 30 + nameLen)));
    o += 30 + nameLen + comp;
  }
  assert.deepEqual(seen, names);
});
