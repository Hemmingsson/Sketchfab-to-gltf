/**
 * ZIP writer. Prefers deflate (method 8); falls back to STORE.
 */

import { crc32 as crc32Core } from "./crc32.js";

function u16(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}
function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}
const MAX_U32 = 0xffffffff;
// This is a ZIP32 writer (no ZIP64). Sizes and offsets are 32-bit, so a >4 GiB
// archive would silently wrap and produce a corrupt, unreadable file. Fail
// loudly instead — the user can shrink textures or pick the GLB-only archive.
function assertFits32(n, what) {
  if (n > MAX_U32) {
    throw new Error(
      `Archive too large for the ZIP format (${what} = ${n} bytes > 4 GiB). ` +
        `Lower "Texture size" in Settings or choose the GLB-only archive.`
    );
  }
}
function concat(chunks) {
  const len = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// Whole-buffer wrapper over the shared offset-capable CRC-32.
export function crc32(data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  return crc32Core(u8, 0, u8.length);
}

async function deflateRaw(data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (typeof CompressionStream === "function") {
    try {
      const cs = new CompressionStream("deflate-raw");
      const ab = await new Response(new Blob([u8]).stream().pipeThrough(cs)).arrayBuffer();
      return new Uint8Array(ab);
    } catch (_) {}
  }
  try {
    const zlib = await import("node:zlib");
    if (zlib && typeof zlib.deflateRawSync === "function") {
      return new Uint8Array(zlib.deflateRawSync(u8));
    }
  } catch (_) {}
  return null;
}

/**
 * @param {{ name: string, data: Uint8Array }[]} files
 * @returns {Promise<Uint8Array>}
 */
export async function buildZip(files) {
  const enc = new TextEncoder();
  const locals = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(String(f.name || "file").replace(/\\/g, "/"));
    let raw;
    if (f.data instanceof Uint8Array) raw = f.data;
    else if (typeof f.data === "string") raw = enc.encode(f.data);
    else if (f.data instanceof ArrayBuffer) raw = new Uint8Array(f.data);
    else raw = new Uint8Array(f.data || []);
    const crc = crc32(raw);
    let payload = raw;
    let method = 0;
    const compressed = await deflateRaw(raw);
    if (compressed && compressed.length < raw.length) {
      payload = compressed;
      method = 8;
    }
    assertFits32(raw.length, `"${f.name}" uncompressed size`);
    assertFits32(offset, "local header offset");
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(payload.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
      name,
      payload,
    ]);
    locals.push(local);
    const cen = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(payload.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    central.push(cen);
    offset += local.length;
  }

  const centralBlob = concat(central);
  assertFits32(offset, "total entry size");
  assertFits32(centralBlob.length, "central directory size");
  if (files.length > 0xffff) {
    throw new Error(`Too many files for the ZIP format (${files.length} > 65535).`);
  }
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBlob.length),
    u32(offset),
    u16(0),
  ]);
  return concat([...locals, centralBlob, end]);
}
