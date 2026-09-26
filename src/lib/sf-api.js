/**
 * Sketchfab public model helpers: UID parse, embed fetch, static key extraction.
 */

import { DEFAULT_STATIC_KEY } from "./decrypt.js";
import { descrambleImageBytes } from "./descramble.js";
import { mapPool } from "./pool.js";
import { createTextureLog, keyScanDone, keyScanProbe } from "./log-groups.js";
import { isHexUid, modelUid } from "./model-url.js";

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

/** `chrome.storage.local` key caching the last key a scan found. */
const STATIC_KEY_CACHE = "sfd.staticKey";

export function extractUid(text) {
  if (!text) return null;
  return modelUid(text) ?? text.match(/\b([a-f0-9]{32})\b/i)?.[1].toLowerCase() ?? null;
}

function browserHeaders(url) {
  const h = { ...UA };
  // Sketchfab media/CDN often expects a site referer (same as the viewer)
  if (/sketchfab\.com/i.test(url)) {
    h.Referer = "https://sketchfab.com/";
    h.Accept = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";
  }
  return h;
}

async function fetchText(url) {
  const resp = await fetch(url, { credentials: "omit", headers: browserHeaders(url) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.text();
}

export async function fetchBytes(url) {
  const resp = await fetch(url, { credentials: "omit", headers: browserHeaders(url) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return new Uint8Array(await resp.arrayBuffer());
}

export async function fetchViewerInfo(uid) {
  const embedUrl = `https://sketchfab.com/models/${uid}/embed`;
  const embedHtml = await fetchText(embedUrl);
  let m = embedHtml.match(
    /id="js-dom-data-prefetched-data"><!--([\s\S]*?)-->/
  );
  if (!m) {
    m = embedHtml.match(
      /js-dom-data-prefetched-data[^>]*>\s*<!--([\s\S]*?)-->/
    );
  }
  if (!m) throw new Error("Could not read public viewer data (private/deleted model?)");
  const raw = m[1].replace(/&#34;/g, '"');
  const data = JSON.parse(raw);
  let key = `/i/models/${uid}`;
  if (!(key in data)) {
    const alt = Object.keys(data).find((k) => k.startsWith(`/i/models/${uid}`));
    if (!alt) throw new Error(`Model ${uid} not in prefetched data`);
    key = alt;
  }
  return { info: data[key], embedHtml, prefetched: data };
}

/** Smallest thumbnail at least `minWidth` wide, else the largest; "" if none. */
export function pickThumbUrl(info, minWidth = 200) {
  const images = ((info && info.thumbnails && info.thumbnails.images) || []).filter((i) => i && i.url);
  images.sort((a, b) => (a.width || 0) - (b.width || 0));
  const pick = images.find((i) => (i.width || 0) >= minWidth) || images[images.length - 1];
  return pick ? pick.url : "";
}

/**
 * Parse viewer material channel bindings from embed options.materials.
 * This is the authoritative mapping (AlbedoPBR / NormalMap / … by texture uid),
 * not filename heuristics.
 *
 * @returns {Map<string, object>} materialName -> channel spec
 */
export function parseViewerMaterials(info) {
  const out = new Map();
  const mats = (info && info.options && info.options.materials) || {};
  for (const [id, mat] of Object.entries(mats)) {
    if (id === "updatedAt" || !mat || typeof mat !== "object") continue;
    const name = mat.name || id;
    const ch = mat.channels || {};
    const texUid = (channel) => {
      const t = ch[channel] && ch[channel].texture;
      return t && t.uid ? String(t.uid).toLowerCase() : null;
    };
    /** Texture uid bound to an enabled channel. */
    const getTex = (channel) => (ch[channel] && ch[channel].enable ? texUid(channel) : null);
    /** Texture uid even when the viewer has the channel switched off. */
    const getTexIgnoringEnable = (channel) => texUid(channel);
    /**
     * Sketchfab reports the texture's internal format. LUMINANCE is a
     * single-channel map, so it can never already be a packed ORM; RGB/RGBA on
     * a metalness channel is what a packed one actually looks like.
     */
    const getTexFormat = (channel) => {
      const c = ch[channel];
      const t = c && c.texture;
      return t && t.internalFormat ? String(t.internalFormat).toUpperCase() : "";
    };
    const getFactor = (channel, def) => {
      const c = ch[channel];
      if (!c || c.enable === false) return def;
      const f = c.factor;
      return typeof f === "number" ? f : def;
    };
    const getColor = (channel, def) => {
      const c = ch[channel];
      if (!c || c.enable === false) return def;
      const col = c.color;
      if (Array.isArray(col) && col.length >= 3) {
        return [col[0], col[1], col[2]];
      }
      return def;
    };
    const channelOn = (channel) => {
      const c = ch[channel];
      return !!(c && c.enable !== false);
    };
    const albedo =
      getTex("AlbedoPBR") ||
      getTex("DiffusePBR") ||
      getTexIgnoringEnable("AlbedoPBR") ||
      getTexIgnoringEnable("DiffusePBR") ||
      getTex("DiffuseColor");
    const normal =
      getTex("NormalMap") ||
      getTex("BumpMap") ||
      getTexIgnoringEnable("NormalMap") ||
      getTexIgnoringEnable("BumpMap");
    const metalness = getTex("MetalnessPBR");
    const roughness = getTex("RoughnessPBR");
    const gloss = getTex("GlossinessPBR");
    const specular = getTex("SpecularPBR") || getTex("SpecularF0");
    const ao = getTex("AOPBR") || getTex("CavityPBR");
    const opacityTex = getTex("Opacity") || getTex("AlphaMask");
    const emit = getTex("EmitColor");

    const metalF = getFactor("MetalnessPBR", 0);
    const glossF = getFactor("GlossinessPBR", null);
    const roughF = getFactor("RoughnessPBR", null);
    let roughnessFactor = 0.9;
    if (typeof roughF === "number") roughnessFactor = roughF;
    else if (typeof glossF === "number") roughnessFactor = Math.max(0, Math.min(1, 1 - glossF));

    const opacity = ch.Opacity || {};
    const alphaMask = ch.AlphaMask || {};
    const opacityEnable = !!(opacity.enable || alphaMask.enable);
    const opacityFactor =
      typeof opacity.factor === "number" ? opacity.factor : 1;
    const opacityType = opacity.type || alphaMask.type || "";
    const albedoFactor = getFactor("AlbedoPBR", 1);

    // Sketchfab's refraction opacity is real glass, not an invisible shell.
    // glTF expresses it with KHR_materials_transmission, so it can be exported
    // instead of dropped.
    const transmission = opacityEnable && /refract/i.test(opacityType);

    // Genuinely invisible: nothing to export at any opacity model.
    const invisible =
      opacityEnable &&
      (opacityFactor <= 0.01 ||
        (opacityType === "additive" && albedoFactor <= 0.01));

    // A shell named for glass or a rim is dropped only when transmission cannot
    // represent it; "rim" must be a whole token so Trim / Brim survive.
    const nameTokens = new Set(String(name).toLowerCase().split(/[^a-z0-9]+/));
    const namedVeil = opacityEnable && (/glass/i.test(name) || nameTokens.has("rim"));

    const skipMesh = invisible || (namedVeil && !transmission);

    const emitFactor = getFactor("EmitColor", 1);
    const emitColor = getColor("EmitColor", [1, 1, 1]);
    const ior = getFactor("IOR", null);
    const sssOn = channelOn("SubsurfaceScattering") || channelOn("Subsurface");
    const normalCh = ch.NormalMap || {};
    out.set(name, {
      id,
      name,
      albedoUid: albedo,
      normalUid: normal,
      metalnessUid: metalness,
      roughnessUid: roughness || gloss,
      // GlossinessPBR is inverted roughness. The factor is converted above;
      // consumers of the *texture* must invert it too (see packOrmPixels).
      roughnessIsGloss: !roughness && !!gloss,
      metalnessFormat: getTexFormat("MetalnessPBR"),
      specularUid: specular,
      aoUid: ao,
      opacityUid: opacityTex,
      emitUid: emit,
      metallicFactor: typeof metalF === "number" ? metalF : 0,
      roughnessFactor,
      normalFlipY: normalCh.flipY !== false, // Sketchfab default often flipY:true
      opacityEnable,
      opacityType,
      transmission,
      skipMesh,
      emitFactor: channelOn("EmitColor") && typeof emitFactor === "number" ? emitFactor : 1,
      emitColor: channelOn("EmitColor") ? emitColor : null,
      clearcoatUid: getTex("ClearCoat") || getTex("Clearcoat"),
      clearcoatRoughUid: getTex("ClearCoatRoughness") || getTex("ClearcoatRoughness"),
      clearcoatNormalUid: getTex("ClearCoatNormal") || getTex("ClearcoatNormal"),
      clearcoatFactor: getFactor("ClearCoat", getFactor("Clearcoat", 0)),
      clearcoatRoughnessFactor: getFactor(
        "ClearCoatRoughness",
        getFactor("ClearcoatRoughness", 0)
      ),
      sheenUid: getTex("Sheen") || getTex("SheenColor"),
      sheenRoughUid: getTex("SheenRoughness"),
      sheenColorFactor: getColor("Sheen", getColor("SheenColor", [0, 0, 0])),
      sheenRoughnessFactor: getFactor("SheenRoughness", 0),
      anisotropyUid: getTex("Anisotropy"),
      anisotropyStrength: getFactor("Anisotropy", 0),
      anisotropyRotation: getFactor("AnisotropyRotation", 0),
      specularColorUid: getTex("SpecularColor") || getTex("SpecularPBR"),
      specularFactor: getFactor("SpecularPBR", getFactor("SpecularF0", 1)),
      specularColorFactor: getColor("SpecularColor", getColor("SpecularPBR", [1, 1, 1])),
      ior: typeof ior === "number" && ior > 1 ? ior : null,
      displacementUid: getTex("Displacement"),
      displacementFactor: getFactor("Displacement", 0),
      volumeThickness: sssOn ? getFactor("SubsurfaceScattering", getFactor("Subsurface", 0.1)) : 0,
      attenuationColor: sssOn
        ? getColor("SubsurfaceScattering", getColor("Subsurface", [1, 1, 1]))
        : null,
      // solid tint when no albedo texture
      baseColorFactor: (() => {
        const dc = ch.DiffuseColor || ch.DiffusePBR || {};
        const col = dc.color;
        if (Array.isArray(col) && col.length >= 3) {
          return [col[0], col[1], col[2], 1];
        }
        return [1, 1, 1, 1];
      })(),
    });
  }
  return out;
}

/**
 * Viewer staging that has a real glTF representation: camera + punctual lights.
 * IBL / background / post / hotspots / sounds are not portable glTF.
 *
 * @param {object} info
 * @returns {{ camera: object|null, lights: object[], unlit: boolean, nearFarRatio: number }}
 */
export function parseViewerScene(info) {
  const opts = (info && info.options) || {};
  const scene = opts.scene || {};
  const cam = opts.camera || {};
  const lighting = opts.lighting || {};
  const shading = opts.shading || {};
  const pos = Array.isArray(cam.position) && cam.position.length >= 3 ? cam.position : null;
  const target = Array.isArray(cam.target) && cam.target.length >= 3 ? cam.target : null;
  const fov = typeof scene.fov === "number" && scene.fov > 0 ? scene.fov : 45;
  const camera =
    pos && target
      ? {
          position: [Number(pos[0]), Number(pos[1]), Number(pos[2])],
          target: [Number(target[0]), Number(target[1]), Number(target[2])],
          yfov: (fov * Math.PI) / 180,
        }
      : null;

  const lights = [];
  if (lighting.enable && Array.isArray(lighting.lights)) {
    for (const L of lighting.lights) {
      if (!L || L.enable === false) continue;
      const type = String(L.type || "DIRECTION").toUpperCase();
      const color = Array.isArray(L.color) && L.color.length >= 3
        ? [L.color[0], L.color[1], L.color[2]]
        : [1, 1, 1];
      const intensity = typeof L.intensity === "number" ? L.intensity : 1;
      const matrix = Array.isArray(L.matrix) && L.matrix.length === 16 ? L.matrix : null;
      let gltfType = "directional";
      if (type === "POINT" || type === "OMNI") gltfType = "point";
      else if (type === "SPOT") gltfType = "spot";
      else if (type === "HEMI" || type === "HEMISPHERE") gltfType = "directional";
      const light = { type: gltfType, color, intensity, matrix };
      if (gltfType === "spot") {
        const angle = typeof L.angle === "number" ? L.angle : 45;
        light.outerConeAngle = (angle * Math.PI) / 180;
      }
      lights.push(light);
    }
  }

  const shade = String(shading.type || shading.renderer || "").toLowerCase();
  return {
    camera,
    lights,
    unlit: /unlit|shadeless|matcap/.test(shade),
    nearFarRatio: typeof scene.nearFarRatio === "number" ? scene.nearFarRatio : 0.005,
  };
}

/**
 * Official clip URLs from embed prefetch (`/i/models/{uid}/animations`).
 */
export function officialAnimationUrls(prefetched, uid) {
  if (!prefetched || !uid) return [];
  const key = Object.keys(prefetched).find((k) =>
    k.includes(`/i/models/${uid}/animations`)
  );
  const results = key && prefetched[key] && prefetched[key].results;
  if (!Array.isArray(results)) return [];
  return results.map((r) => r && r.url).filter(Boolean);
}

export function isBinzFormat(info) {
  return !!info?.files?.[0]?.p?.[0]?.b;
}

export function modelBinzUrls(info) {
  const osgjsUrl = info.files[0].osgjsUrl;
  return [
    osgjsUrl,
    osgjsUrl.replace("file.binz", "model_file.binz"),
    osgjsUrl.replace("file.binz", "model_file_wireframe.binz"),
  ];
}

export function getDiterB(info) {
  return info.files[0].p[0].b;
}

/**
 * Extract static 40-hex key from live viewer JS. Auto-updates when Sketchfab rotates it.
 */
export async function extractStaticKey(embedHtml, onProgress) {
  const urls = [
    ...new Set(
      [...embedHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1])
    ),
  ].sort((a, b) => {
    const sa = a.includes("/static/builds/web/dist/") ? 0 : 1;
    const sb = b.includes("/static/builds/web/dist/") ? 0 : 1;
    return sa - sb;
  });

  const patterns = [
    /exports\s*\.\s*k\s*:\s*\(\)\s*=>\s*\w+\}\s*;\s*const\s+\w+\s*=\s*"([0-9a-f]{40})(?:\\n)?"/,
    /\{k:\s*\(\)\s*=>\s*\w+\}[^;]*;\s*const\s+\w+\s*=\s*"([0-9a-f]{40})(?:\\n)?"/,
    /a\.d\(t,\{\s*k:\(\)=>\w+\s*\}\)[^"]{0,40}const\s+\w+\s*=\s*"([0-9a-f]{40})(?:\\n)?"/,
    /const\s+\w+\s*=\s*"([0-9a-f]{40})\\n"/,
    /const\s+\w+\s*=\s*"([0-9a-f]{40})"/,
  ];

  let probes = 0;
  /** @param {string} key @param {"scan" | "stored" | "default"} source */
  const found = (key, source) => {
    if (onProgress) onProgress(...keyScanDone(key, probes, source));
    return key;
  };

  for (const url of urls) {
    const name = url.split("/").pop();
    let js;
    try {
      probes++;
      if (onProgress) onProgress(...keyScanProbe(name));
      js = await fetchText(url);
    } catch {
      continue;
    }
    for (const pat of patterns) {
      const mm = js.match(pat);
      if (mm && /^[0-9a-f]{40}$/i.test(mm[1])) {
        const key = mm[1].toLowerCase();
        try {
          await chrome.storage.local.set({ [STATIC_KEY_CACHE]: key });
        } catch (_) {}
        return found(key, "scan");
      }
    }
    if (js.length < 200000) {
      const hexes = [...js.matchAll(/["']([0-9a-f]{40})(?:\\n)?["']/g)].map(
        (x) => x[1].toLowerCase()
      );
      const uniq = [...new Set(hexes)];
      if (uniq.length === 1) {
        try {
          await chrome.storage.local.set({ [STATIC_KEY_CACHE]: uniq[0] });
        } catch (_) {}
        return found(uniq[0], "scan");
      }
    }
  }

  try {
    const cached = (await chrome.storage.local.get(STATIC_KEY_CACHE))[STATIC_KEY_CACHE];
    if (cached && /^[0-9a-f]{40}$/i.test(cached)) {
      return found(cached.toLowerCase(), "stored");
    }
  } catch (_) {}
  return found(DEFAULT_STATIC_KEY, "default");
}

/**
 * The descramble seed for a texture. The Textures API reports `pk` on the
 * image, the texture, or any sibling image; the first finite one wins.
 * `null` means the texture is not scrambled.
 */
function readPk(tex, im) {
  const vals = [];
  if (im && im.pk != null) vals.push(im.pk);
  if (tex && tex.pk != null) vals.push(tex.pk);
  if (tex && tex.images) {
    for (const x of tex.images) {
      if (x && x.pk != null) vals.push(x.pk);
    }
  }
  for (const v of vals) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function imageEdge(im) {
  return Math.max(im && im.width ? im.width : 0, im && im.height ? im.height : 0);
}

function scoreImage(im) {
  const w = im.width || 0;
  const h = im.height || 0;
  const area = w * h || 0;
  const size = im.size || 0;
  const url = (im.url || "").toLowerCase();
  const isPng = url.endsWith(".png") || (im.options && !im.options.quality);
  return area * 10 + (isPng ? 5 : 0) + Math.min(size, 1e9) / 1e12;
}

/** Highest-scoring image, first one winning a tie. */
function bestByScore(images) {
  let best = null;
  let bestScore = -Infinity;
  for (const im of images) {
    const score = scoreImage(im);
    if (score > bestScore) {
      best = im;
      bestScore = score;
    }
  }
  return best ? { ...best } : null;
}

/**
 * Pick a texture variant. `maxEdge` 0 / omitted = original (largest); a
 * positive cap picks the best variant within it, else the smallest above it.
 *
 * @param {Array<object>} images
 * @param {number} [maxEdge]
 * @returns {object|null} a copy of the chosen image
 */
export function pickBestImage(images, maxEdge = 0) {
  if (!images || !images.length) return null;
  const usable = images.filter((im) => {
    const w = im.width || 0;
    const h = im.height || 0;
    return !(w > 0 && h > 0 && (w < 32 || h < 32));
  });
  const pool = usable.length ? usable : images;
  if (!(maxEdge > 0)) return bestByScore(pool);

  const atMost = pool.filter((im) => imageEdge(im) <= maxEdge);
  if (atMost.length) return bestByScore(atMost);

  let nearest = null;
  for (const im of pool) {
    const e = imageEdge(im);
    if (!e) continue;
    if (!nearest || e < imageEdge(nearest)) nearest = im;
  }
  return nearest ? { ...nearest } : null;
}

/** Lower-case image extension, with `.jpeg` folded into `.jpg`. */
function normalizeImageExt(ext) {
  const lower = String(ext).toLowerCase();
  return lower === ".jpeg" ? ".jpg" : lower;
}

/**
 * Download public model textures (highest resolution available).
 * Indexes by texture uid for viewer material channel matching.
 */
export async function fetchTextures(uid, onProgress, opts) {
  const maxEdge = (opts && opts.maxEdge) || 0;
  const concurrency = Math.max(1, (opts && opts.concurrency) || 3);
  const out = [];
  const headers = {
    ...UA,
    Referer: `https://sketchfab.com/models/${uid}/embed`,
    Accept: "application/json,image/*,*/*;q=0.8",
  };
  // Prefer the optimized endpoint the viewer uses; fall back to plain.
  let results = [];
  const endpointFailures = [];
  for (const label of ["optimized", "plain"]) {
    const path = `https://sketchfab.com/i/models/${uid}/textures${label === "optimized" ? "?optimized=1" : ""}`;
    try {
      const resp = await fetch(path, { credentials: "omit", headers });
      if (!resp.ok) {
        endpointFailures.push(`${label} HTTP ${resp.status}`);
        continue;
      }
      const data = await resp.json();
      results = data.results || [];
      if (results.length) {
        if (onProgress) onProgress(`Textures API: ${label} (${results.length})`);
        break;
      }
      endpointFailures.push(`${label} listed no textures`);
    } catch (e) {
      endpointFailures.push(`${label}: ${e && e.message ? e.message : e}`);
    }
  }
  if (!results.length) {
    if (onProgress) onProgress(`Textures unavailable: ${endpointFailures.join("; ")}`);
    return out;
  }

  let scrambledHints = 0;
  const total = results.length;
  const log = createTextureLog(total, onProgress);
  const fetched = await mapPool(results, concurrency, async (tex, idx) => {
    const i = idx + 1;
    const best = pickBestImage(tex.images || [], maxEdge);
    if (!best || !best.url) {
      log.skip();
      return null;
    }

    const tuid = String(tex.uid || "").toLowerCase();
    let base = String(tex.name || `texture_${i}`).replace(/[^\w.\-]+/g, "_");
    const urlPath = best.url.split("?")[0];
    const mExt = base.match(/\.(png|jpe?g|webp|gif)$/i);
    if (mExt) {
      base = base.slice(0, -mExt[0].length) + normalizeImageExt(mExt[0]);
    } else {
      const uExt = (urlPath.match(/\.(png|jpe?g|webp|gif)$/i) || [])[0];
      if (uExt) base += normalizeImageExt(uExt);
      else base += urlPath.includes(".png") ? ".png" : ".jpg";
    }

    const pk = readPk(tex, best);
    const row = log.start(base);
    try {
      let bytes = await fetchBytes(best.url);
      if (!bytes || bytes.length < 32) {
        row.fail("empty download", "warn");
        return null;
      }
      const inBytes = bytes.length;
      const isPng =
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
      const isWebp =
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
      if (!isPng && !isJpg && !isWebp) {
        row.fail("skip non-image", "warn");
        return null;
      }
      let fromDescramble = false;
      if (pk != null && (best.width || 0) >= 64 && (best.height || 0) >= 64) {
        row.step(`descramble start pk=${pk} ${bytes.length} B`);
        try {
          const dec = await descrambleImageBytes(bytes, pk, row.progress);
          if (dec && dec.length > 64) {
            bytes = dec;
            fromDescramble = true;
            row.step(`descramble ok ${dec.length} B`);
          } else {
            row.step("descramble empty result", "warn");
          }
        } catch (de) {
          row.step(`descramble failed: ${de && de.message ? de.message : de}`, "warn");
        }
      } else if (pk == null) {
        row.step("passthrough");
      }
      if ((best.width || 0) >= 512 && bytes.length < 80_000 && isJpg) {
        scrambledHints++;
      }
      const imageUids = [];
      const addId = (id) => {
        const s = String(id || "").toLowerCase();
        if (isHexUid(s) && imageUids.indexOf(s) === -1) imageUids.push(s);
      };
      addId(tuid);
      for (const im of tex.images || []) {
        addId(im && im.uid);
        const url = (im && im.url) || "";
        const fn = (url.split("?")[0].split("/").pop() || "").toLowerCase();
        if (fn) addId(fn.replace(/\.(png|jpe?g|webp|gif)$/i, ""));
      }
      row.done({
        width: best.width,
        height: best.height,
        inBytes,
        outBytes: bytes.length,
        fromDescramble,
        pk,
      });
      return {
        name: `textures/${base}`,
        data: bytes,
        uid: tuid,
        imageUids,
        originalName: base,
        width: best.width || 0,
        height: best.height || 0,
        fromDescramble,
        pk,
      };
    } catch (e) {
      row.fail(`failed: ${e.message || e}`);
      return null;
    }
  });
  for (const item of fetched) {
    if (item) out.push(item);
  }
  log.finish();
  if (scrambledHints > 0 && onProgress) {
    onProgress(
      `  NOTE: ${scrambledHints} texture(s) look unusually small for their resolution — Sketchfab may serve protected/preview maps for this model`
    );
  }
  return out;
}
