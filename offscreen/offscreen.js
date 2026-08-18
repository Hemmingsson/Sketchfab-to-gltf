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

// Diagnostic logging. Offscreen logs appear in the offscreen document's own
// console (chrome://extensions → Inspect views → offscreen.html).
const DEBUG = true;
function log(...a) {
  if (DEBUG) {
    try {
      console.log("[sf-dl/offscreen]", ...a);
    } catch (_) {}
  }
}

function emit(msg) {
  try {
    chrome.runtime.sendMessage({ source: "sf-offscreen", ...msg });
  } catch (e) {
    log("emit failed:", e && e.message);
  }
}

/** id → object URL, so a later revoke can free the blob. */
const blobUrls = new Map();
/** ids with a run in flight, to ignore duplicate "run" messages. */
const inFlight = new Set();

function revoke(id) {
  const url = blobUrls.get(id);
  if (url) {
    try {
      URL.revokeObjectURL(url);
    } catch (_) {}
    blobUrls.delete(id);
  }
}

async function runJob(id, url) {
  log("runJob start", id, url);
  let phase = "queued";
  const onProgress = (text) => {
    phase = mapPhase(text, phase);
    log("progress", id, phase, "-", String(text || ""));
    emit({ id, kind: "progress", phase, text: String(text || "") });
  };

  try {
    const { filename, bytes, kind } = await downloadModel(url, onProgress);
    const type = kind === "glb" ? "model/gltf-binary" : "application/zip";
    const blob = new Blob([bytes], { type });
    const blobUrl = URL.createObjectURL(blob);
    blobUrls.set(id, blobUrl);
    // Fallback: free the blob even if no revoke message ever arrives.
    setTimeout(() => revoke(id), 120_000);
    log("runJob done", id, filename, bytes.length, "bytes");
    emit({ id, kind: "done", blobUrl, filename, bytes: bytes.length });
  } catch (err) {
    log("runJob error", id, err && err.message);
    emit({ id, kind: "error", error: String((err && err.message) || err) });
  } finally {
    inFlight.delete(id);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== "offscreen") return;

  if (msg.action === "run") {
    log("run received", msg.id);
    if (inFlight.has(msg.id)) {
      log("already in flight, ignoring", msg.id);
      return;
    }
    inFlight.add(msg.id);
    runJob(msg.id, msg.url);
    return;
  }

  if (msg.action === "revoke") {
    revoke(msg.id);
    return;
  }
});
