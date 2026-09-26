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
  pickThumbUrl,
  parseViewerMaterials,
  parseViewerScene,
  officialAnimationUrls,
} from "./sf-api.js";
import { decryptBinzBytes, loadWasmBytes, outNameFor } from "./decrypt.js";
import { buildZip } from "./zip.js";
import { planOrm, packOrmTexture } from "./orm.js";
import {
  convertOsgjsToGlbFromFiles,
  classifyTextureName,
  resolveUidToBase,
  textureBasename,
  collectAnimationBinGzNames,
  animationBinUrl,
  gunzipBytes,
  summarizeOsgAnimations,
} from "./osgjs2gltf.js";
import { exportFilename, parseTextureSize, sanitizeName } from "./settings.js";

/**
 * Extra animation keyframe URLs. Sketchfab serves them at
 * `…/<version>/animations/<hash>.bin.gz`, not next to `file.binz`.
 * Query string on the osgjs URL is preserved.
 */
export function extraAnimationUrls(osgjsUrl, osgjs, officialUrls) {
  if (Array.isArray(officialUrls) && officialUrls.length) {
    return officialUrls.filter(Boolean);
  }
  if (!osgjsUrl || osgjs == null || osgjs === "") return [];
  return collectAnimationBinGzNames(osgjs).map((name) => animationBinUrl(osgjsUrl, name));
}

function utf8Bytes(text) {
  return new TextEncoder().encode(String(text ?? ""));
}

function summarizeJson(json) {
  if (!json) return null;
  const prims = (json.meshes || []).flatMap((m) => m.primitives || []);
  return {
    nodes: (json.nodes || []).length,
    meshes: (json.meshes || []).length,
    skins: (json.skins || []).length,
    animations: (json.animations || []).map((a) => ({
      name: a.name,
      channels: (a.channels || []).length,
    })),
    morphPrims: prims.filter((p) => p.targets && p.targets.length).length,
    skinnedPrims: prims.filter((p) => p.attributes && p.attributes.JOINTS_0 != null).length,
    color0Prims: prims.filter((p) => p.attributes && p.attributes.COLOR_0 != null).length,
    nodeNames: (json.nodes || []).map((n) => n.name).filter(Boolean).slice(0, 80),
  };
}

function buildDebugInfo({
  pageUrl,
  uid,
  name,
  author,
  osgjsUrl,
  animBinNames,
  animUrls,
  animFetch,
  osgjs,
  convertResult,
  glb,
  decrypted,
}) {
  let osgAnims = [];
  try {
    osgAnims = summarizeOsgAnimations(osgjs);
  } catch (_) {
    osgAnims = [];
  }
  return {
    builtAt: new Date().toISOString(),
    pageUrl,
    uid,
    name,
    author,
    osgjsUrl,
    animBinNames,
    animUrls,
    animFetch,
    osgAnims,
    nodes: convertResult ? nodeRoster(convertResult.json) : [],
    convert: convertResult
      ? {
          geometryCount: convertResult.geometryCount,
          skipped: convertResult.skipped,
          convertErrors: convertResult.convertErrors,
          textureEmbedCount: convertResult.textureEmbedCount,
          glbBytes: glb ? glb.length : 0,
          summary: summarizeJson(convertResult.json),
          animDebug: convertResult.animDebug || null,
        }
      : { failed: true },
    decryptedFiles: Object.entries(decrypted)
      .filter(([fname]) => !/^textures\//i.test(fname))
      .map(([fname, data]) => ({
        name: fname,
        bytes: data && data.length != null ? data.length : 0,
      })),
  };
}

const DEBUG_README = `Sketchfab to glTF — debug bundle
==========================================

<name>-<uid8>.glb   converted glTF binary (omitted if convert failed)
file.osgjs          decrypted osgjs scene graph
model_file.bin      decrypted geometry / skins / morphs
<hash>.bin.gz       gunzipped animation keyframes (if the CDN fetch worked)

debug/log.txt       full download + convert log (same lines as the popup)
debug/info.json     URLs, fetch results, node roster, animation skip reasons
debug/gltf.json     converted glTF JSON only (no BIN chunk)
debug/raw-*         raw CDN body when a .bin.gz was missing or not gzip
`;

/**
 * Files written into a debug / fallback ZIP. Textures are omitted; the GLB
 * already embeds them. The full glTF JSON is written only to debug/gltf.json
 * so info.json stays readable.
 */
export function packDebugFiles({
  name,
  uid8,
  glb,
  decrypted,
  logLines,
  info,
}) {
  const files = [];
  if (glb) files.push({ name: exportFilename({ name, uid: uid8 }), data: glb });
  for (const [fname, data] of Object.entries(decrypted || {})) {
    if (/^textures\//i.test(fname)) continue;
    files.push({ name: fname, data });
  }
  const { gltf, ...infoRest } = info || {};
  files.push({ name: "debug/README.txt", data: utf8Bytes(DEBUG_README) });
  files.push({ name: "debug/log.txt", data: utf8Bytes((logLines || []).join("\n") + "\n") });
  files.push({
    name: "debug/info.json",
    data: utf8Bytes(JSON.stringify(infoRest, null, 2) + "\n"),
  });
  if (gltf) {
    files.push({
      name: "debug/gltf.json",
      data: utf8Bytes(JSON.stringify(gltf, null, 2) + "\n"),
    });
  }
  return files;
}

/**
 * Separate-files glTF package from convertOsgjsToGlb's `gltfExternal`.
 * Layout matches the URIs in model.gltf: model.bin + textures/<file>.
 *
 * @param {{ jsonText: Uint8Array, bin: Uint8Array, textureAliases?: { to: string, data: Uint8Array }[] }} gltfExternal
 * @returns {{ name: string, data: Uint8Array }[]}
 */
export function packGltfFiles(gltfExternal) {
  const files = [
    { name: "model.gltf", data: gltfExternal.jsonText },
    { name: "model.bin", data: gltfExternal.bin },
  ];
  const seen = new Set();
  for (const alias of gltfExternal.textureAliases || []) {
    if (!alias || !alias.to || !alias.data) continue;
    if (seen.has(alias.to)) continue;
    seen.add(alias.to);
    files.push({ name: alias.to, data: alias.data });
  }
  return files;
}

function nodeRoster(json) {
  if (!json || !Array.isArray(json.nodes)) return [];
  return json.nodes.map((n, i) => ({
    i,
    name: n.name || "",
    aliases: (n.extras && n.extras.osgUpdateNames) || [],
    mesh: n.mesh,
    skin: n.skin,
  }));
}

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
  step("Packing ORM maps…");

  // Resolve uids exactly the way the converter does, so the packer never misses
  // a texture the converter would bind.
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
 * @param {import("./log-groups.js").OnProgress} [onProgress] text plus optional group meta (see log-groups.js)
 * @param {{
 *   debugZip?: boolean,
 *   exportFormat?: "glb"|"gltf-zip",
 *   maxTextureEdge?: 0|2048|4096,
 *   includeViewerScene?: boolean,
 *   uidInFilename?: boolean,
 *   onMeta?: (meta: { name: string, author: string, thumbUrl: string }) => void
 * }} [options]
 * @returns {Promise<{ filename: string, bytes: Uint8Array, kind: "glb"|"zip", meshCount: number, imageCount: number }>}
 */
export async function downloadModel(
  pageUrl,
  onProgress = () => {},
  {
    debugZip = false,
    exportFormat = "glb",
    maxTextureEdge = 0,
    includeViewerScene = true,
    uidInFilename = true,
    onMeta,
  } = {}
) {
  const edge = parseTextureSize(maxTextureEdge);
  const logLines = [];
  /** @type {import("./log-groups.js").OnProgress} */
  const step = (msg, meta) => {
    const line = String(msg || "");
    // Grouped lines repeat their text; keep the detail in the debug log.
    logLines.push(meta && meta.detail ? `${line} — ${meta.detail}` : line);
    onProgress(line, meta);
  };

  const decrypted = {};
  let osgjsUrl = "";
  const animFetch = [];

  try {
    const uid = extractUid(pageUrl);
    if (!uid) {
      throw new Error("Open a Sketchfab model page first (URL with model id).");
    }
    step(`UID: ${uid}`);

    step("Reading public viewer…");
    const { info, embedHtml, prefetched } = await fetchViewerInfo(uid);
    const name = sanitizeName(info.name || uid);
    const author =
      (info.user && (info.user.displayName || info.user.username)) || "unknown";
    step(`Model: ${info.name || name} (by ${author})`);
    onMeta?.({ name: info.name || name, author, thumbUrl: pickThumbUrl(info) });

    // Authoritative material channel map from the live viewer (fixes wrong ORM/"veil")
    const viewerMaterials = parseViewerMaterials(info);
    const viewerScene = parseViewerScene(info);
    const sceneForConvert = includeViewerScene
      ? viewerScene
      : viewerScene
        ? {
            camera: null,
            lights: [],
            unlit: viewerScene.unlit,
            nearFarRatio: viewerScene.nearFarRatio,
          }
        : null;
    step(`Viewer materials: ${viewerMaterials.size}`);
    if (includeViewerScene && viewerScene.camera) {
      step(`Viewer camera: fov ${((viewerScene.camera.yfov * 180) / Math.PI).toFixed(1)}°`);
    }
    if (includeViewerScene && viewerScene.lights.length) {
      step(`Viewer lights: ${viewerScene.lights.length}`);
    }
    if (!includeViewerScene) step("Viewer camera & lights: omitted (setting)");
    let skipCount = 0;
    for (const spec of viewerMaterials.values()) {
      if (spec.skipMesh) skipCount++;
    }
    if (skipCount) step(`  (${skipCount} glass/invisible material(s) will be skipped)`);

    if (!isBinzFormat(info)) {
      throw new Error(
        "Private or unsupported format."
      );
    }

    // The grouped "key-scan" row is the header; it closes as "Decrypt key <8 hex>…".
    const staticKey = await extractStaticKey(embedHtml, step);

    step("Loading WASM decrypt module…");
    const wasmBytes = await loadWasmBytes();
    step(`WASM loaded (${wasmBytes.length} bytes)`);

    const diterB = getDiterB(info);
    step(`diter.b length: ${String(diterB || "").length}`);
    const urls = modelBinzUrls(info);

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

    osgjsUrl = urls[0];
    let osgjs = decrypted["file.osgjs"];
    if (osgjs instanceof Uint8Array) osgjs = new TextDecoder().decode(osgjs);
    if (typeof osgjs === "string") osgjs = JSON.parse(osgjs);
    const animBinNames = collectAnimationBinGzNames(osgjs);
    const officialAnims = officialAnimationUrls(prefetched, uid);
    const animUrls = extraAnimationUrls(osgjsUrl, osgjs, officialAnims);
    if (officialAnims.length) {
      step(`Official animation URLs: ${officialAnims.length}`);
    }
    let animBinsFailed = 0;
    step(`Animation bins referenced in osgjs: ${animBinNames.length}` +
      (animBinNames.length ? ` (${animBinNames.join(", ")})` : ""));
    for (const url of animUrls) {
      const fname = url.split("/").pop().split("?")[0];
      step(`Downloading ${fname}…`);
      step(`  URL: ${url}`);
      try {
        const raw = await fetchBytes(url);
        const head = String.fromCharCode(...raw.slice(0, 64));
        if (raw.length < 32 || head.startsWith("<") || /AccessDenied|Error/i.test(head)) {
          animBinsFailed++;
          const preview = head.replace(/\s+/g, " ").slice(0, 180);
          animFetch.push({ fname, url, ok: false, bytes: raw.length, error: "not-bin", preview });
          decrypted[`debug/raw-${fname}.txt`] = utf8Bytes(head);
          step(`  WARNING: ${fname} is not a keyframe bin (${raw.length} bytes): ${preview}`);
          continue;
        }
        const isGzip = raw[0] === 0x1f && raw[1] === 0x8b;
        decrypted[`debug/raw-${fname}`] = raw;
        decrypted[fname] = isGzip ? await gunzipBytes(raw) : raw;
        animFetch.push({
          fname,
          url,
          ok: true,
          gzip: isGzip,
          fetchedBytes: raw.length,
          unzippedBytes: decrypted[fname].length,
        });
        step(`  → ${fname} (${decrypted[fname].length} bytes${isGzip ? ", gunzipped" : ", already decoded"})`);
      } catch (e) {
        animBinsFailed++;
        const err = e && e.message ? e.message : String(e);
        animFetch.push({ fname, url, ok: false, error: err });
        step(`  WARNING: animation bin failed ${fname}: ${err}`);
      }
    }
    if (animBinsFailed) {
      step(
        `WARNING: ${animBinsFailed}/${animUrls.length} animation bin(s) failed — clips may be missing or incomplete`
      );
    }

    if (edge) step(`Texture size cap: ${edge}px`);

    step("Downloading textures…");
    let textures = await fetchTextures(uid, step, {
      maxEdge: edge,
      concurrency: 3,
    });
    if (textures.length) {
      textures = await packOrmMaps(viewerMaterials, textures, step, edge);
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
    let imageCount = 0;
    let convertResult = null;
    try {
      convertResult = await convertOsgjsToGlbFromFiles(
        decrypted,
        viewerMaterials,
        textures,
        info.name,
        sceneForConvert,
        { external: exportFormat === "gltf-zip" }
      );
      glb = convertResult.glb;
      geometryCount = convertResult.geometryCount;
      const textureEmbedCount =
        convertResult.textureEmbedCount ||
        (convertResult.json && convertResult.json.images && convertResult.json.images.length) ||
        0;
      imageCount = textureEmbedCount;
      const animNames = (convertResult.json && convertResult.json.animations || []).map((a) => a.name).filter(Boolean);
      const skipN = (convertResult.animDebug && convertResult.animDebug.skips || []).length;
      step(
        `  GLB ready (${glb.length} bytes, ${geometryCount} mesh(es), ${textureEmbedCount} image(s) embedded, ${animNames.length} animation(s)` +
          (animNames.length ? `: ${animNames.join(", ")}` : animBinNames.length ? ", clips in osgjs but none emitted — see debug/info.json" : "") +
          (skipN ? `, ${skipN} channel(s) skipped` : "") +
          `)`
      );
      for (const warning of convertResult.warnings || []) step(`  ${warning}`);
      if (convertResult.skipped || convertResult.convertErrors) {
        step(`  WARNING: ${convertResult.skipped || 0} mesh(es) skipped, ${convertResult.convertErrors || 0} failed to convert — model may be incomplete`);
      }
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
    const filenameFor = (kind) =>
      exportFilename({
        name,
        uid,
        uidInFilename,
        exportFormat: kind === "gltf-zip" ? "gltf-zip" : "glb",
        debugZip: kind === "debug",
        sourceZip: kind === "source",
      });
    const debugCtx = {
      pageUrl,
      uid,
      name: info.name || name,
      author,
      osgjsUrl,
      animBinNames,
      animUrls,
      animFetch,
      osgjs,
      convertResult,
      glb,
      decrypted,
    };

    if (debugZip) {
      const debugInfo = buildDebugInfo(debugCtx);
      const files = packDebugFiles({
        name,
        uid8,
        glb: glb && geometryCount > 0 ? glb : null,
        decrypted,
        logLines,
        info: {
          ...debugInfo,
          gltf: convertResult && convertResult.json ? convertResult.json : null,
        },
      });
      step(`DEBUG: bundling GLB + osgjs + debug log (${files.length} entries)…`);
      const zip = await buildZip(files);
      return { filename: filenameFor("debug"), bytes: zip, kind: "zip", meshCount: geometryCount, imageCount };
    }

    if (glb && geometryCount > 0) {
      if (exportFormat === "gltf-zip" && convertResult && convertResult.gltfExternal) {
        const files = packGltfFiles(convertResult.gltfExternal);
        imageCount = Math.max(0, files.length - 2);
        step(`Building glTF ZIP (${files.length} entries)…`);
        const zip = await buildZip(files);
        return {
          filename: filenameFor("gltf-zip"),
          bytes: zip,
          kind: "zip",
          meshCount: geometryCount,
          imageCount,
        };
      }
      return { filename: filenameFor("glb"), bytes: glb, kind: "glb", meshCount: geometryCount, imageCount };
    }

    const files = packDebugFiles({
      name,
      uid8,
      glb: null,
      decrypted,
      logLines,
      info: buildDebugInfo(debugCtx),
    });
    step(`Building ZIP (${files.length} entries)…`);
    const zip = await buildZip(files);
    return {
      filename: filenameFor("source"),
      bytes: zip,
      kind: "zip",
      meshCount: 0,
      imageCount: 0,
    };
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    step(`ERROR: ${message}`);
    if (debugZip && Object.keys(decrypted).length) {
      try {
        const failUid = extractUid(pageUrl) || "unknown";
        const files = packDebugFiles({
          name: "failed",
          uid8: failUid.slice(0, 8),
          glb: null,
          decrypted,
          logLines,
          info: { pageUrl, uid: failUid, osgjsUrl, animFetch, error: message },
        });
        const zip = await buildZip(files);
        return {
          filename: exportFilename({ name: "failed", uid: failUid, debugZip: true }),
          bytes: zip,
          kind: "zip",
          meshCount: 0,
          imageCount: 0,
        };
      } catch (_) {
        /* fall through */
      }
    }
    throw e instanceof Error ? e : new Error(message);
  }
}
