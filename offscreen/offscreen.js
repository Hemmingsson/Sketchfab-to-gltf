/**
 * Offscreen document: runs the preserved pipeline (decrypt, descramble, convert)
 * off the service worker, which is killed on large texture packs. It has a DOM,
 * so it builds blob URLs the SW (which owns chrome.downloads) can save.
 */
import { downloadModel } from "../lib/pipeline.js";

/**
 * Coarse pipeline phase from a progress line. The background turns the phase
 * into a smoothly-animated percentage, so we only classify the stage here (no
 * per-texture percentages). First match wins, case-insensitive.
 */
const PHASE_RULES = [
  { needles: ["reading public viewer", "uid:", "model:", "viewer materials"], phase: "reading" },
  {
    needles: ["extracting decrypt", "reading key", "static key", "wasm", "downloading file.binz", "decrypting", "file.osgjs", "model_file"],
    phase: "decrypting",
  },
  { needles: ["downloading textures", "textures api", "textures:", "texture ", "descramble"], phase: "textures" },
  { needles: ["packed", "orm ", "ready for glb"], phase: "packing" },
  { needles: ["converting osgjs", "glb ready"], phase: "converting" },
  { needles: ["building zip"], phase: "zipping" },
  { needles: ["saving", "save started", "zip ready"], phase: "saving" },
];

/** Map a human progress line to a phase; keep the previous phase if unknown. */
function mapPhase(text, prevPhase) {
  const lower = String(text || "").toLowerCase();
  for (const rule of PHASE_RULES) {
    if (rule.needles.some((needle) => lower.includes(needle))) return rule.phase;
  }
  return prevPhase;
}

function emit(msg) {
  try {
    chrome.runtime.sendMessage({ source: "sf-offscreen", ...msg });
  } catch (e) {
    console.error("[sf-dl] emit failed:", e && e.message);
  }
}

/** id → object URL, so a later revoke can free the blob. */
const blobUrls = new Map();
/**
 * id → { bytes: Uint8Array, mime } retained for the background's data-URL
 * fallback (see "refetchBytes"). Freed alongside the object URL on revoke or
 * the 120s timeout so a failed save doesn't pin a 4K pack in memory forever.
 */
const blobBytes = new Map();
/** ids with a run in flight, to ignore duplicate "run" messages. */
const inFlight = new Set();

/**
 * Base64-encode raw bytes, chunked over 32768-byte subarrays so
 * String.fromCharCode does not blow the argument-count / call stack on large
 * (4K texture) packs. Returns a plain string safe to send over runtime
 * messaging (which serializes as JSON, not structured clone).
 */
function bytesToBase64(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const CHUNK = 32768;
  let binary = "";
  for (let i = 0; i < u8.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function revoke(id) {
  const url = blobUrls.get(id);
  if (url) {
    try {
      URL.revokeObjectURL(url);
    } catch (_) {}
    blobUrls.delete(id);
  }
  blobBytes.delete(id);
}

async function runJob(id, url) {
  let phase = "queued";
  const onProgress = (text) => {
    phase = mapPhase(text, phase);
    emit({ id, kind: "progress", phase, text: String(text || "") });
  };

  try {
    const { filename, bytes, kind } = await downloadModel(url, onProgress);
    const type = kind === "glb" ? "model/gltf-binary" : "application/zip";
    const blob = new Blob([bytes], { type });
    const blobUrl = URL.createObjectURL(blob);
    blobUrls.set(id, blobUrl);
    // Retain the raw bytes for the background's data-URL fallback path.
    blobBytes.set(id, { bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), mime: type });
    // Fallback: free the blob even if no revoke message ever arrives.
    setTimeout(() => revoke(id), 120_000);
    emit({ id, kind: "done", blobUrl, filename, bytes: bytes.length });
  } catch (err) {
    console.error("[sf-dl] pipeline failed", id, err && err.message);
    emit({ id, kind: "error", error: String((err && err.message) || err) });
  } finally {
    inFlight.delete(id);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== "offscreen") return;

  if (msg.action === "run") {
    if (inFlight.has(msg.id)) {
      return;
    }
    inFlight.add(msg.id);
    runJob(msg.id, msg.url);
    return;
  }

  if (msg.action === "refetchBytes") {
    // Background's data-URL fallback: hand back the retained bytes as a base64
    // STRING. Chrome's runtime messaging serializes as JSON (not structured
    // clone), so an ArrayBuffer would arrive as {} and yield a 0-byte file. A
    // plain string always survives the message boundary. We hold the bytes, so
    // we base64-encode here and let background build `data:<mime>;base64,<str>`.
    const entry = blobBytes.get(msg.id);
    if (entry && entry.bytes) {
      sendResponse({ ok: true, base64: bytesToBase64(entry.bytes), mime: entry.mime });
    } else {
      console.warn("[sf-dl] refetchBytes miss — bytes unavailable for fallback", msg.id);
      sendResponse({ ok: false });
    }
    return true;
  }

  if (msg.action === "revoke") {
    revoke(msg.id);
    return;
  }
});
