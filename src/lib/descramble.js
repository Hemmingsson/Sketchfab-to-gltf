/**
 * CPU port of Sketchfab's texture-protection fragment shader (pv=1).
 *
 * Textures API gives `pk` per image. Viewer sets
 *   uO = -(pk * 64 % (w * h)),  uY = true
 */

import { asU8, copyBuf, decodePngRgba, encodePngRgba, isPng } from "./png.js";

function idiv(a, b) {
  if (!b) return 0;
  return a * b >= 0 ? Math.trunc(a / b) : -Math.trunc(Math.abs(a) / Math.abs(b));
}

function modI(i, u) {
  return i - idiv(i, u) * u;
}

function minI(a, b) {
  return a < b ? a : b;
}

function maxI(a, b) {
  return a < b ? b : a;
}

function f3(y, t, f) {
  const x = minI(y, t);
  const n = maxI(y, t);
  if (f < x) return Math.trunc((f * (f + 1)) / 2);
  if (f < n) return Math.trunc((x * (x + 1)) / 2) + x * (f - x);
  const r = f - n;
  return (
    Math.trunc((x * (x + 1)) / 2) +
    x * (n - x) +
    (x - 1) * r -
    Math.trunc(((r - 1) * r) / 2)
  );
}

function i3(y, t, xx, xy) {
  const r = minI(y, t);
  const n = maxI(y, t);
  const v = xx + xy;
  const h = modI(v, 2) === 0;
  if (v < r) {
    return h ? f3(y, t, v) + v - xy : f3(y, t, v) + xy;
  }
  if (v < n) {
    let s = t - xy - 1;
    if (y < t) s = r - (y - xx);
    return h ? f3(y, t, v) + s : f3(y, t, v) + r - s - 1;
  }
  const s = t - xy - 1;
  const e = r + n - v - 1;
  return h ? f3(y, t, v) + s : f3(y, t, v) + e - s - 1;
}

function u3(y, t, x) {
  const v = minI(y, t);
  const r = maxI(y, t);
  if (x < Math.trunc((v * (v + 1)) / 2)) {
    const n = Math.trunc((-1 + 1e-6 + Math.sqrt(8 * x + 1)) / 2);
    const h = x - f3(y, t, n);
    const s = modI(n, 2) === 0;
    return s ? [h, n - h] : [n - h, h];
  }
  if (x < Math.trunc((v * (v + 1)) / 2) + v * (r - v)) {
    x = x - Math.trunc((v * (v + 1)) / 2);
    const n = v + Math.trunc(x / v);
    const s = modI(x, v);
    const h = modI(n, 2) === 0;
    const g = n - v + s + 1;
    const e = v - s - 1;
    const S = n - s;
    const T = s;
    if (y > t) return h ? [g, e] : [S, T];
    return h ? [T, S] : [e, g];
  }
  // GLSL: s = (-1 + int(sqrt(float(8*n+1)))) / 2
  let n =
    Math.trunc((v * (v - 1)) / 2) -
    (x - (Math.trunc((v * (v + 1)) / 2) + v * (r - v))) -
    1;
  const s = Math.trunc((-1 + Math.trunc(Math.sqrt(8 * n + 1))) / 2);
  n = r + v - s - 2;
  let h = x - f3(y, t, n);
  const g = modI(n, 2) === 0;
  const e = v + r - n - 1;
  if (g) h = e - h - 1;
  const S = n + h - y + 1;
  return [n - S, S];
}

function fVec(vx, vy, uSx, uSy) {
  const y = Math.trunc(uSx / 8);
  const t = Math.trunc(uSy / 8);
  const x = i3(y, t, Math.trunc(vx / 8), Math.trunc(vy / 8));
  const n = modI(x, 4);
  vx = modI(vx, 8);
  vy = modI(vy, 8);
  let rx = vx;
  let ry = vy;
  if (n === 1) rx = 7 - vx;
  if (n === 2) {
    rx = vy;
    ry = vx;
  }
  if (n === 3) {
    rx = 7 - vy;
    ry = vx;
  }
  return x * 64 + rx + ry * 8;
}

function i1(i, uSx, uSy) {
  const v = uSx * uSy;
  if (i < 0) i += v;
  i = modI(i, v);
  const y = Math.trunc(uSx / 8);
  const n = Math.trunc(uSy / 8);
  const h = Math.trunc(i / 64);
  const r = i - h * 64;
  const s = Math.trunc(r / 8);
  const S = r - s * 8;
  const e = modI(h, 4);
  const g = u3(y, n, h);
  let Tx = g[0] * 8;
  let Ty = g[1] * 8;
  if (e === 0) {
    Tx += S;
    Ty += s;
  }
  if (e === 1) {
    Tx += 7 - S;
    Ty += s;
  }
  if (e === 2) {
    Tx += s;
    Ty += S;
  }
  if (e === 3) {
    Tx += s;
    Ty += 7 - S;
  }
  return [Tx, Ty];
}

function tFn(yx, yy, off, uSx, uSy) {
  const v = uSx * uSy;
  let n = fVec(yx, yy, uSx, uSy) + off;
  if (n > v) n -= v;
  if (n < 0) n += v;
  if (n > v) return -1;
  if (n < 0) return -2;
  return n;
}

/** Viewer uniform: uO = -(pk * 64 % (w * h)) */
export function offsetFromPk(pk, w, h) {
  const area = w * h;
  if (!area) return 0;
  let rem = (Number(pk) * 64) % area;
  if (rem < 0) rem += area;
  return -rem;
}

/** Rows per slice: a 4K map is ~0.3 ms/row, so a slice stays well under 100 ms. */
const ROWS_PER_SLICE = 256;

/**
 * Descramble RGBA pixels into a new buffer. Yields between row slices so the offscreen document
 * keeps answering messages on 4K maps.
 * @param {Uint8ClampedArray|Uint8Array} src RGBA, top-left origin
 * @param {number} w
 * @param {number} h
 * @param {number} pk protection key from textures API
 * @param {boolean} [uY=true] match viewer default
 * @returns {Promise<Uint8ClampedArray>}
 */
export async function descrambleRgbaAsync(src, w, h, pk, uY = true) {
  const out = new Uint8ClampedArray(w * h * 4);
  const offset = offsetFromPk(pk, w, h);
  for (let y = 0; y < h; y++) {
    if (y > 0 && y % ROWS_PER_SLICE === 0) await yieldTask();
    descrambleRow(src, out, w, h, offset, y, uY);
  }
  return out;
}

/**
 * A macrotask yield. Not setTimeout: the offscreen document is hidden, and Chrome throttles
 * chained timers in hidden pages.
 */
function yieldTask() {
  const sched = /** @type {any} */ (globalThis).scheduler;
  if (sched && typeof sched.yield === "function") return sched.yield();
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve(undefined);
    };
    port2.postMessage(null);
  });
}

function descrambleRow(src, out, w, h, offset, y, uY) {
  const yy = uY ? h - y - 1 : y;
  for (let x = 0; x < w; x++) {
    const n = tFn(x, yy, offset, w, h);
    const di = (y * w + x) * 4;
    if (n >= 0) {
      const srcXY = i1(n, w, h);
      const sx = srcXY[0];
      const sy = srcXY[1];
      if (sx >= 0 && sy >= 0 && sx < w && sy < h) {
        const si = (sy * w + sx) * 4;
        out[di] = src[si];
        out[di + 1] = src[si + 1];
        out[di + 2] = src[si + 2];
        out[di + 3] = src[si + 3];
        continue;
      }
    }
    // Leftover edge on non-8 sizes: keep transparent, never error-red.
    out[di] = 0;
    out[di + 1] = 0;
    out[di + 2] = 0;
    out[di + 3] = 0;
  }
}

function isJpeg(bytes) {
  return bytes && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function guessMime(bytes) {
  if (isPng(bytes)) return "image/png";
  if (isJpeg(bytes)) return "image/jpeg";
  return "application/octet-stream";
}

async function decodeViaImageDecoder(bytes) {
  if (typeof ImageDecoder !== "function") return null;
  const u8 = asU8(bytes);
  const mime = guessMime(u8);
  if (mime === "application/octet-stream") return null;
  let dec = null;
  let image = null;
  try {
    // ImageDecoder.data must be ArrayBuffer / view / stream — NOT a Blob.
    dec = new ImageDecoder({ data: copyBuf(u8), type: mime });
    const result = await dec.decode();
    image = result && result.image;
    if (!image) return null;
    const width = image.displayWidth || image.codedWidth;
    const height = image.displayHeight || image.codedHeight;
    if (typeof image.allocationSize === "function") {
      const n = image.allocationSize({ format: "RGBA" });
      const rgba = new Uint8ClampedArray(n);
      await image.copyTo(rgba, { format: "RGBA" });
      return { rgba, width, height };
    }
  } catch (_) {
    return null;
  } finally {
    try {
      if (image) image.close();
    } catch (_) {}
    try {
      if (dec) dec.close();
    } catch (_) {}
  }
  return null;
}

async function decodeViaBitmap(bytes) {
  if (typeof createImageBitmap !== "function") return null;
  if (typeof OffscreenCanvas === "undefined") return null;
  let bmp = null;
  try {
    const u8 = asU8(bytes);
    bmp = await createImageBitmap(new Blob([copyBuf(u8)], { type: guessMime(u8) }));
    const width = bmp.width;
    const height = bmp.height;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, width, height);
    return { rgba: img.data, width, height };
  } catch (_) {
    return null;
  } finally {
    try {
      if (bmp) bmp.close();
    } catch (_) {}
  }
}

async function decodeToRgba(bytes) {
  const u8 = asU8(bytes);
  if (isPng(u8)) {
    try {
      return await decodePngRgba(u8);
    } catch (_) {}
  }
  const viaDec = await decodeViaImageDecoder(u8);
  if (viaDec) return viaDec;
  const viaBmp = await decodeViaBitmap(u8);
  if (viaBmp) return viaBmp;
  throw new Error("cannot decode " + guessMime(u8));
}

/**
 * One image at a time from decode to encode: textures are fetched 3 at once, and each 4K map
 * holds a 64 MB source plus a 64 MB output while it is worked on.
 */
let imageTail = Promise.resolve();

/**
 * If `pk` is set, descramble a PNG/JPEG blob to PNG bytes.
 */
export function descrambleImageBytes(bytes, pk, onProgress) {
  const run = imageTail.then(() => descrambleImageBytesNow(bytes, pk, onProgress));
  imageTail = run.catch(() => {});
  return run;
}

async function descrambleImageBytesNow(bytes, pk, onProgress) {
  if (bytes == null || pk == null || pk === "") {
    throw new Error("missing pk or bytes");
  }
  const key = Number(pk);
  if (!Number.isFinite(key)) throw new Error("bad pk " + pk);
  const { rgba, width, height } = await decodeToRgba(bytes);
  if (width < 64 || height < 64) {
    throw new Error("too small " + width + "x" + height);
  }
  // Viewer still descrambles maps that are not multiples of 8 (hair 400x401).
  // The shader floors to 8px tiles; leftover edge pixels may be wrong.
  if (onProgress) onProgress(`  descramble ${width}x${height} pk=${key}`);
  const out = await descrambleRgbaAsync(rgba, width, height, key, true);
  return encodePngRgba(out, width, height);
}
