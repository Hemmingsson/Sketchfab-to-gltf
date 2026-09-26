/**
 * Minimal PNG codec: 8-bit non-interlaced decode to RGBA, and RGBA encode.
 * Uses CompressionStream / DecompressionStream for the zlib layer, so it works
 * in the offscreen document without a DOM canvas.
 */

import { crc32 } from "./crc32.js";

/** A Uint8Array view over `bytes` (ArrayBuffer, any view, or array-like). */
export function asU8(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return new Uint8Array(bytes);
}

/** A standalone ArrayBuffer copy of `u8` — Blob and ImageDecoder reject offset views. */
export function copyBuf(u8) {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

export function isPng(bytes) {
  if (!bytes || bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) return false;
  return true;
}

function u32be(b, o) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function putU32be(b, o, v) {
  b[o] = (v >>> 24) & 255;
  b[o + 1] = (v >>> 16) & 255;
  b[o + 2] = (v >>> 8) & 255;
  b[o + 3] = v & 255;
}

async function inflateZlib(src) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("no DecompressionStream");
  }
  const ds = new DecompressionStream("deflate");
  const ab = await new Response(new Blob([copyBuf(src)]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(ab);
}

async function deflateZlib(src) {
  if (typeof CompressionStream !== "function") {
    throw new Error("no CompressionStream");
  }
  const cs = new CompressionStream("deflate");
  const ab = await new Response(new Blob([copyBuf(src)]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(ab);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(raw, w, h, bpp) {
  const stride = w * bpp;
  const out = new Uint8Array(h * stride);
  let src = 0;
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const type = raw[src++];
    const row = new Uint8Array(stride);
    if (src + stride > raw.length) throw new Error("png row overflow");
    if (type === 0) {
      row.set(raw.subarray(src, src + stride));
    } else {
      for (let i = 0; i < stride; i++) {
        const x = raw[src + i];
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let v = x;
        if (type === 1) v = x + a;
        else if (type === 2) v = x + b;
        else if (type === 3) v = x + ((a + b) >> 1);
        else if (type === 4) v = x + paeth(a, b, c);
        else throw new Error("png filter " + type);
        row[i] = v & 255;
      }
    }
    out.set(row, y * stride);
    prev = row;
    src += stride;
  }
  return out;
}

function toRgba(px, w, h, colorType, bitDepth, palette, trns) {
  if (bitDepth !== 8) throw new Error("png bitDepth " + bitDepth);
  const n = w * h;
  const rgba = new Uint8ClampedArray(n * 4);
  if (colorType === 6) {
    rgba.set(px.subarray(0, n * 4));
    return rgba;
  }
  if (colorType === 2) {
    for (let i = 0, p = 0; i < n; i++, p += 3) {
      const o = i * 4;
      rgba[o] = px[p];
      rgba[o + 1] = px[p + 1];
      rgba[o + 2] = px[p + 2];
      rgba[o + 3] = 255;
    }
    return rgba;
  }
  if (colorType === 0) {
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const g = px[i];
      rgba[o] = g;
      rgba[o + 1] = g;
      rgba[o + 2] = g;
      rgba[o + 3] = 255;
    }
    return rgba;
  }
  if (colorType === 4) {
    for (let i = 0, p = 0; i < n; i++, p += 2) {
      const o = i * 4;
      const g = px[p];
      rgba[o] = g;
      rgba[o + 1] = g;
      rgba[o + 2] = g;
      rgba[o + 3] = px[p + 1];
    }
    return rgba;
  }
  if (colorType === 3 && palette) {
    for (let i = 0; i < n; i++) {
      const idx = px[i] * 3;
      const o = i * 4;
      rgba[o] = palette[idx];
      rgba[o + 1] = palette[idx + 1];
      rgba[o + 2] = palette[idx + 2];
      rgba[o + 3] = trns && px[i] < trns.length ? trns[px[i]] : 255;
    }
    return rgba;
  }
  throw new Error("png colorType " + colorType);
}

/** @returns {Promise<{ rgba: Uint8ClampedArray, width: number, height: number }>} */
export async function decodePngRgba(bytes) {
  const b = asU8(bytes);
  if (!isPng(b)) throw new Error("not a PNG");
  let o = 8;
  let w = 0;
  let h = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let trns = null;
  const idats = [];
  while (o + 12 <= b.length) {
    const len = u32be(b, o);
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    const data = b.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      w = u32be(data, 0);
      h = u32be(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "tRNS") {
      trns = data;
    } else if (type === "IDAT") {
      idats.push(data);
    } else if (type === "IEND") {
      break;
    }
    o += 12 + len;
  }
  if (!w || !h) throw new Error("png missing IHDR");
  if (interlace) throw new Error("png interlaced");
  let idatLen = 0;
  for (const c of idats) idatLen += c.length;
  const idat = new Uint8Array(idatLen);
  let p = 0;
  for (const c of idats) {
    idat.set(c, p);
    p += c.length;
  }
  const bpp =
    colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const raw = await inflateZlib(idat);
  const px = unfilter(raw, w, h, bpp);
  return { rgba: toRgba(px, w, h, colorType, bitDepth, palette, trns), width: w, height: h };
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  putU32be(out, 0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  putU32be(out, 8 + data.length, crc32(out, 4, 4 + data.length));
  return out;
}

/** Encode RGBA pixels as an 8-bit truecolour-with-alpha PNG. */
export async function encodePngRgba(rgba, w, h) {
  const stride = w * 4;
  const raw = new Uint8Array(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  putU32be(ihdr, 0, w);
  putU32be(ihdr, 4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = await deflateZlib(raw);
  const sig = new Uint8Array(PNG_SIG);
  const cIHDR = chunk("IHDR", ihdr);
  const cIDAT = chunk("IDAT", idat);
  const cIEND = chunk("IEND", new Uint8Array(0));
  const out = new Uint8Array(sig.length + cIHDR.length + cIDAT.length + cIEND.length);
  let o = 0;
  out.set(sig, o);
  o += sig.length;
  out.set(cIHDR, o);
  o += cIHDR.length;
  out.set(cIDAT, o);
  o += cIDAT.length;
  out.set(cIEND, o);
  return out;
}
