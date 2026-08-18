/**
 * Offscreen document: runs the preserved pipeline (decrypt, descramble, convert)
 * off the service worker, which is killed on large texture packs. It has a DOM,
 * so it builds blob URLs the SW (which owns chrome.downloads) can save.
 */
import { downloadModel } from "../lib/pipeline.js";

/** Static progress-text → {pct, phase} table. First hit wins, case-insensitive. */
const PROGRESS_RULES = [
  { needles: ["reading public viewer", "uid:"], phase: "reading", pct: 8 },
  { needles: ["extracting decrypt", "reading key", "static key"], phase: "decrypting", pct: 18 },
  { needles: ["wasm", "downloading file.binz", "decrypting", "file.osgjs", "model_file"], phase: "decrypting", pct: 28 },
  { needles: ["downloading textures", "textures api", "textures:"], phase: "textures", pct: 34 },
  { needles: ["descramble"], phase: "textures", pct: 60 },
  { needles: ["packed", "orm", "ready for glb"], phase: "packing", pct: 78 },
  { needles: ["converting osgjs"], phase: "converting", pct: 85 },
  { needles: ["glb ready"], phase: "converting", pct: 92 },
  { needles: ["building zip"], phase: "zipping", pct: 95 },
  { needles: ["saving", "save started", "zip ready"], phase: "saving", pct: 97 },
];

/**
 * Map a human progress line to {pct, phase}. Handles the "Texture n/m"
 * interpolation (34→74) specially; falls back to the previous values when
 * nothing matches (the "keep previous" rule).
 *
 * @param {string} text
 * @param {{pct:number, phase:string}} prev
 * @returns {{pct:number, phase:string}}
 */
function mapProgress(text, prev) {
  const lower = String(text || "").toLowerCase();

  const tex = lower.match(/texture (\d+)\/(\d+)/);
  if (tex) {
    const n = Number(tex[1]);
    const m = Number(tex[2]);
    const frac = m > 0 ? n / m : 0;
    return { phase: "textures", pct: 34 + Math.round(40 * frac) };
  }

  for (const rule of PROGRESS_RULES) {
    if (rule.needles.some((needle) => lower.includes(needle))) {
      return { phase: rule.phase, pct: rule.pct };
    }
  }

  return { pct: prev.pct, phase: prev.phase };
}

function emit(msg) {
  try {
    chrome.runtime.sendMessage({ source: "sf-offscreen", ...msg });
  } catch (_) {}
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
  const prev = { pct: 0, phase: "queued" };
  const onProgress = (text) => {
    const mapped = mapProgress(text, prev);
    prev.pct = mapped.pct;
    prev.phase = mapped.phase;
    emit({ id, kind: "progress", pct: mapped.pct, phase: mapped.phase, text: String(text || "") });
  };

  try {
    const { filename, bytes, kind } = await downloadModel(url, onProgress);
    const type = kind === "glb" ? "model/gltf-binary" : "application/zip";
    const blob = new Blob([bytes], { type });
    const blobUrl = URL.createObjectURL(blob);
    blobUrls.set(id, blobUrl);
    // Fallback: free the blob even if no revoke message ever arrives.
    setTimeout(() => revoke(id), 120_000);
    emit({ id, kind: "done", blobUrl, filename, bytes: bytes.length });
  } catch (err) {
    emit({ id, kind: "error", error: String((err && err.message) || err) });
  } finally {
    inFlight.delete(id);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== "offscreen") return;

  if (msg.action === "run") {
    if (inFlight.has(msg.id)) return;
    inFlight.add(msg.id);
    runJob(msg.id, msg.url);
    return;
  }

  if (msg.action === "revoke") {
    revoke(msg.id);
    return;
  }
});
