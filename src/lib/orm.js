/**
 * Pack Sketchfab's separate metalness / roughness maps into one glTF
 * metallicRoughness texture (glTF: G = roughness, B = metalness).
 *
 * Sketchfab serves MetalnessPBR and RoughnessPBR as independent grayscale
 * maps. Binding the metalness map straight into metallicRoughnessTexture
 * makes its green channel drive roughness, so a black (non-metal) map reads
 * as roughness 0 and every surface turns into a mirror.
 *
 * The pixel math here is deliberately free of DOM APIs so it can be unit
 * tested under `node --test`; decoding/encoding lives in packOrmTexture().
 */

/** @param {string} filename */
function baseName(filename) {
  return String(filename || "")
    .split("/")
    .pop()
    .split("?")[0];
}

/** @param {string} filename */
function stemOf(filename) {
  return baseName(filename)
    .replace(/\.[^.]+$/, "")
    .toLowerCase();
}

/**
 * True when a filename denotes an already-packed ORM/MRAO texture, as opposed
 * to a single-channel `*_metallic` / `*_roughness` map.
 *
 * classifyTextureName() answers 'metalrough' for both, which is why binding on
 * that alone is not safe.
 *
 * @param {string} filename
 * @returns {boolean}
 */
export function isPackedOrmName(filename) {
  const stem = stemOf(filename);
  if (!stem) return false;
  const packed = stem.replace(/[^a-z0-9]+/g, "");
  if (/metallicroughness|metalroughness|metalrough|mrao|occlusionroughnessmetallic/.test(packed)) {
    return true;
  }
  // "arm" is also an AO/Roughness/Metallic convention, but too ambiguous to
  // trust: a wrong passthrough is the mirror bug, a miss only costs detail.
  return /(?:^|[_-])(orm|rma)(?:[_-]|$)/.test(stem);
}

/**
 * Decide how a material's metal/rough channels should reach glTF.
 *
 * @param {object} spec - viewer material spec (see parseViewerMaterials)
 * @param {(uid: string) => (string|null)} resolve - uid -> texture basename
 * @param {(name: string) => string} [classify] - optional name classifier
 * @returns {{action: 'passthrough'|'pack'|'factors', texture?: string,
 *            metalName?: string|null, roughName?: string|null,
 *            invertRough?: boolean, reason: string}}
 */
export function planOrm(spec, resolve, classify) {
  const res = typeof resolve === "function" ? resolve : () => null;
  const s = spec || {};
  let metalName = s.metalnessUid ? res(s.metalnessUid) : null;
  const roughName = s.roughnessUid ? res(s.roughnessUid) : null;

  // Sketchfab sometimes points MetalnessPBR at a colour/id map, not a mask.
  if (metalName && typeof classify === "function" && classify(metalName) === "albedo") {
    metalName = null;
  }

  if (!metalName && !roughName) {
    return { action: "factors", reason: "no metal/rough maps" };
  }

  // roughnessUid falls back to GlossinessPBR, which is inverted roughness.
  const invertRough = !!(s.roughnessIsGloss && roughName);
  const pack = (reason) => ({
    action: "pack",
    metalName: metalName || null,
    roughName: roughName || null,
    invertRough,
    reason,
  });

  // 1. One texture wired to both channels is a packed map by construction.
  const sameUid =
    s.metalnessUid &&
    s.roughnessUid &&
    String(s.metalnessUid).toLowerCase() === String(s.roughnessUid).toLowerCase();
  if (sameUid && metalName) {
    return { action: "passthrough", texture: metalName, reason: "one texture on both channels" };
  }

  // 2. Two distinct maps always need packing.
  if (metalName && roughName) return pack("separate metal + rough");

  if (roughName) return pack("rough only");

  // Metal map with no roughness map: the only genuinely ambiguous case.
  // Prefer the format Sketchfab reports over anything in the filename.
  const fmt = String(s.metalnessFormat || "").toUpperCase();
  if (fmt === "LUMINANCE" || fmt === "ALPHA" || fmt === "LUMINANCE_ALPHA") {
    return pack("single-channel metal map (LUMINANCE)");
  }
  if (fmt === "RGB" || fmt === "RGBA") {
    return { action: "passthrough", texture: metalName, reason: `packed metal texture (${fmt})` };
  }

  // No format reported: fall back to the filename, then to packing, which is
  // the safe direction — a wrong passthrough restores the mirror bug.
  if (isPackedOrmName(metalName)) {
    return { action: "passthrough", texture: metalName, reason: "name suggests packed ORM" };
  }
  return pack("metal only");
}

/**
 * Compose the ORM pixel buffer.
 *
 * Channels follow the glTF spec: R is free (occlusion), G roughness,
 * B metalness. Grayscale sources carry the same value in every channel, so
 * the red channel is read as the source value.
 *
 * A missing channel falls back to non-metal and fairly rough.
 *
 * @param {{metal?: Uint8Array|Uint8ClampedArray|null,
 *          rough?: Uint8Array|Uint8ClampedArray|null,
 *          width: number, height: number,
 *          invertRough?: boolean}} opts
 * @returns {Uint8ClampedArray} RGBA pixels
 */
export function packOrmPixels(opts) {
  const { width, height } = opts;
  const n = width * height;
  if (!(n > 0)) throw new Error("packOrmPixels: bad dimensions");

  const metal = opts.metal || null;
  const rough = opts.rough || null;
  const invert = !!opts.invertRough;

  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const r = rough ? rough[p] : 229;
    out[p] = 255;
    out[p + 1] = invert ? 255 - r : r;
    out[p + 2] = metal ? metal[p] : 0;
    out[p + 3] = 255;
  }
  return out;
}

/**
 * Decode source maps, resample to a common size and encode a packed ORM PNG.
 * Requires createImageBitmap + OffscreenCanvas (offscreen document / worker).
 *
 * @param {{metal?: {data: Uint8Array, name?: string}|null,
 *          rough?: {data: Uint8Array, name?: string}|null,
 *          invertRough?: boolean, maxEdge?: number}} sources
 * @returns {Promise<{data: Uint8Array, width: number, height: number}>}
 */
export async function packOrmTexture(sources) {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    throw new Error("ORM packing needs createImageBitmap + OffscreenCanvas");
  }
  const decodeErrors = [];
  const metalBmp = await decode(sources.metal, decodeErrors);
  const roughBmp = await decode(sources.rough, decodeErrors);
  if (!metalBmp && !roughBmp) {
    const why = decodeErrors.length ? decodeErrors.join("; ") : "no metal or rough map given";
    throw new Error(`ORM packing: no source maps (${why})`);
  }

  const cap = sources.maxEdge && sources.maxEdge > 0 ? sources.maxEdge : Infinity;
  const width = Math.max(1, Math.min(cap, Math.max(metalBmp?.width || 0, roughBmp?.width || 0)));
  const height = Math.max(1, Math.min(cap, Math.max(metalBmp?.height || 0, roughBmp?.height || 0)));

  const packed = packOrmPixels({
    metal: metalBmp ? resample(metalBmp, width, height) : null,
    rough: roughBmp ? resample(roughBmp, width, height) : null,
    width,
    height,
    invertRough: !!sources.invertRough,
  });

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(new ImageData(packed, width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const data = new Uint8Array(await blob.arrayBuffer());
  metalBmp?.close();
  roughBmp?.close();
  return { data, width, height };
}

/**
 * Decode one source map. A failure is collected into `errors` rather than
 * thrown, so one unreadable map still lets the other drive the packed texture.
 */
async function decode(entry, errors) {
  if (!entry || !entry.data || !entry.data.length) return null;
  try {
    return await createImageBitmap(new Blob([entry.data]));
  } catch (e) {
    errors.push(`${entry.name || "map"}: ${e && e.message ? e.message : e}`);
    return null;
  }
}

function resample(bmp, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}
