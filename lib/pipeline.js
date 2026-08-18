/**
 * Full download pipeline for a public Sketchfab model → glTF (GLB) ZIP.
 */
import {
  extractUid,
  fetchViewerInfo,
  isBinzFormat,
  modelBinzUrls,
  getDiterB,
  extractStaticKey,
  fetchTextures,
  fetchBytes,
  sanitizeName,
  parseViewerMaterials,
} from "./sf-api.js";
import { decryptBinzBytes, loadWasmBytes, outNameFor } from "./decrypt.js";
import { buildZip } from "./zip.js";
import {
  convertOsgjsToGlbFromFiles,
  classifyTextureName,
  resolveUidToBase,
  textureBasename,
} from "./osgjs2gltf.js";
import { planOrm, packOrmTexture } from "./orm.js";

/**
 * Pack each material's separate metalness / roughness maps into one glTF ORM
 * texture, appending the result to the texture list and tagging the spec so
 * the converter binds it.
 *
 * Failures are non-fatal: the material falls back to numeric factors, which
 * looks flat but never turns a plastic surface into a mirror.
 *
 * @param {Map<string, object>} viewerMaterials
 * @param {Array<{name: string, data: Uint8Array, uid?: string}>} textures
 * @param {(msg: string) => void} step
 * @param {number} maxTextureEdge
 * @returns {Promise<Array>} textures, plus any packed ORM maps
 */
async function packOrmMaps(viewerMaterials, textures, step, maxTextureEdge) {
  if (!viewerMaterials || !viewerMaterials.size || !textures.length) return textures;

  // Resolve uids exactly the way the converter does, so a texture the
  // converter would bind is never one the packer failed to find.
  const byBase = new Map();
  for (const t of textures) {
    byBase.set(textureBasename(t.name).toLowerCase(), t);
  }
  const resolve = (uid) => resolveUidToBase(uid, textures);
  const entryFor = (base) =>
    base ? byBase.get(textureBasename(base).toLowerCase()) || null : null;

  const added = [];
  let packed = 0;
  let reused = 0;
  const cache = new Map();

  for (const spec of viewerMaterials.values()) {
    const plan = planOrm(spec, resolve, classifyTextureName);
    if (plan.action !== "pack") continue;

    const key = `${plan.metalName || "-"}|${plan.roughName || "-"}|${plan.invertRough ? 1 : 0}`;
    if (cache.has(key)) {
      spec.packedOrmName = cache.get(key);
      reused++;
      continue;
    }

    const metal = entryFor(plan.metalName);
    const rough = entryFor(plan.roughName);
    if (!metal && !rough) continue;

    const stem = String(plan.metalName || plan.roughName)
      .replace(/\.[^.]+$/, "")
      .replace(/_(metallic|metalness|metal|roughness|rough|gloss|glossiness)$/i, "");
    const outName = `textures/${stem}_ORM.png`;

    try {
      const result = await packOrmTexture({
        metal,
        rough,
        invertRough: plan.invertRough,
        maxEdge: maxTextureEdge,
      });
      added.push({
        name: outName,
        data: result.data,
        uid: "",
        originalName: `${stem}_ORM.png`,
        width: result.width,
        height: result.height,
        fromOrmPack: true,
      });
      byBase.set(`${stem}_ORM.png`.toLowerCase(), added[added.length - 1]);
      cache.set(key, `${stem}_ORM.png`);
      spec.packedOrmName = `${stem}_ORM.png`;
      packed++;
    } catch (e) {
      step(`  ORM pack failed for ${spec.name || "?"}: ${e && e.message ? e.message : e}`);
    }
  }

  if (packed || reused) {
    step(`  Packed ${packed} ORM map(s) from separate metal/rough maps` + (reused ? ` (${reused} shared)` : ""));
  }
  return added.length ? textures.concat(added) : textures;
}

/**
 * @param {string} pageUrl
 * @param {(msg:string)=>void} [onProgress]
 * @returns {Promise<{ filename: string, bytes: Uint8Array, kind: "glb"|"zip" }>}
 */
export async function downloadModel(pageUrl, onProgress = () => {}) {
  const step = (msg) => {
    const line = String(msg || "");
    try {
      onProgress(line);
    } catch (_) {}
  };

  try {
    const uid = extractUid(pageUrl);
    if (!uid) {
      throw new Error("Open a Sketchfab model page first (URL with model id).");
    }
    step(`UID: ${uid}`);

    step("Reading public viewer…");
    const { info, embedHtml } = await fetchViewerInfo(uid);
    const name = sanitizeName(info.name || uid);
    const author =
      (info.user && (info.user.displayName || info.user.username)) || "unknown";
    step(`Model: ${info.name || name} (by ${author})`);

    // Authoritative material channel map from the live viewer (fixes wrong ORM/"veil")
    const viewerMaterials = parseViewerMaterials(info);
    step(`Viewer materials: ${viewerMaterials.size}`);
    let skipCount = 0;
    for (const spec of viewerMaterials.values()) {
      if (spec.skipMesh) skipCount++;
    }
    if (skipCount) step(`  (${skipCount} glass/invisible material(s) will be skipped)`);

    if (!isBinzFormat(info)) {
      throw new Error(
        "This model is not in the current encrypted .binz format (or is private)."
      );
    }

    step("Extracting decrypt key (auto)…");
    const staticKey = await extractStaticKey(embedHtml, step);
    step(`Static key: ${staticKey.slice(0, 8)}… (${staticKey.length} hex)`);

    step("Loading WASM decrypt module…");
    const wasmBytes = await loadWasmBytes();
    step(`WASM loaded (${wasmBytes.length} bytes)`);

    const diterB = getDiterB(info);
    step(`diter.b length: ${String(diterB || "").length}`);
    const urls = modelBinzUrls(info);
    const decrypted = {};

    for (const url of urls) {
      const binzName = url.split("/").pop().split("?")[0];
      step(`Downloading ${binzName}…`);
      let enc;
      try {
        enc = await fetchBytes(url);
      } catch (e) {
        if (binzName.includes("wireframe")) {
          step(`Skip ${binzName} (not available)`);
          continue;
        }
        throw new Error(
          `Download ${binzName} failed: ${e && e.message ? e.message : e}`
        );
      }
      step(`Decrypting ${binzName} (${enc.length} bytes)…`);
      let plain;
      try {
        plain = await decryptBinzBytes(wasmBytes, enc, diterB, staticKey);
      } catch (e) {
        throw new Error(
          `Decrypt ${binzName} failed: ${e && e.message ? e.message : e}`
        );
      }
      const outName = outNameFor(binzName);
      decrypted[outName] = plain;
      step(`  → ${outName} (${plain.length} bytes)`);
    }

    if (!decrypted["file.osgjs"] || !decrypted["model_file.bin"]) {
      throw new Error(
        `Missing file.osgjs or model_file.bin after decrypt. Have: ${Object.keys(decrypted).join(", ")}`
      );
    }

    // Textures are always on and full-resolution so they embed into the GLB.
    const maxTextureEdge = 0;

    step("Downloading textures…");
    let textures = await fetchTextures(uid, step, {
      maxEdge: maxTextureEdge,
      concurrency: 3,
    });
    if (textures.length) {
      textures = await packOrmMaps(viewerMaterials, textures, step, maxTextureEdge);
    }
    for (const t of textures) decrypted[t.name] = t.data;
    if (textures.length) {
      const fromDec = textures.filter((t) => t.fromDescramble).length;
      step(
        `  ${textures.length} texture(s) ready for GLB embed` +
          (fromDec ? ` (${fromDec} descrambled)` : "")
      );
    } else {
      step("  No public textures found (GLB will be untextured)");
    }

    step("Converting osgjs → glTF (GLB)…");
    let glb = null;
    let geometryCount = 0;
    try {
      const result = await convertOsgjsToGlbFromFiles(decrypted, viewerMaterials, textures);
      glb = result.glb;
      geometryCount = result.geometryCount;
      const textureEmbedCount =
        result.textureEmbedCount ||
        (result.json && result.json.images && result.json.images.length) ||
        0;
      step(
        `  GLB ready (${glb.length} bytes, ${geometryCount} mesh(es), ${textureEmbedCount} image(s) embedded)`
      );
      if (!geometryCount) {
        step("  WARNING: GLB has 0 meshes — convert may be incomplete");
      }
    } catch (e) {
      step(
        `  glTF convert failed: ${e && e.message ? e.message : e}; packaging raw mesh (no .glb)…`
      );
      glb = null;
    }

    const uid8 = uid.slice(0, 8);

    // Normal path: a real GLB with geometry embeds textures and stands alone.
    if (glb && geometryCount > 0) {
      const filename = `${name}-${uid8}.glb`;
      return { filename, bytes: glb, kind: "glb" };
    }

    // Fallback: no usable GLB — ZIP the raw decrypted source files so the
    // model can still be recovered by hand.
    const files = [];
    for (const [fname, data] of Object.entries(decrypted)) {
      if (/^textures\//i.test(fname)) continue;
      files.push({ name: fname, data });
    }
    step(`Building ZIP (${files.length} entries)…`);
    const zip = await buildZip(files);
    const filename = `${name}-${uid8}-source.zip`;
    return { filename, bytes: zip, kind: "zip" };
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    step(`ERROR: ${message}`);
    throw e instanceof Error ? e : new Error(message);
  }
}
