import { classifyLine, progressPhase } from "./progress.js";

/**
 * The converter: runs the pipeline for `run` requests and keeps each result's
 * bytes for the background's data-URL fallback. Transport-free so it can live
 * in Chrome's offscreen document (wired to runtime messages) or directly in a
 * background that is already a DOM page (Orion), where offscreen documents
 * cannot be recreated after `closeDocument`.
 *
 * @param {{
 *   downloadModel: (url: string, onProgress: any, opts: any) => Promise<any>,
 *   emit: (event: Record<string, unknown>) => void,
 * }} deps
 */
export function createConverter({ downloadModel, emit }) {
  /** id -> object URL plus the bytes retained for the data-URL fallback. */
  const saved = new Map();
  const inFlight = new Set();

  /** @param {Record<string, unknown>} msg */
  const send = (msg) => emit({ source: "sf-offscreen", ...msg });

  function revoke(id) {
    const entry = saved.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    URL.revokeObjectURL(entry.url);
    saved.delete(id);
  }

  async function runJob(id, url, opts) {
    let phase = "queued";
    const onProgress = (text, meta) => {
      phase = progressPhase(text, meta, phase);
      const line = classifyLine(text);
      send({ id, kind: "progress", phase, text: line.text, logKind: line.kind, depth: line.depth, meta });
    };
    const onMeta = (meta) => send({ id, kind: "meta", ...meta });

    try {
      const { filename, bytes, kind, meshCount, imageCount } = await downloadModel(url, onProgress, {
        ...opts,
        onMeta,
      });
      const type = kind === "glb" ? "model/gltf-binary" : "application/zip";
      const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const blobUrl = URL.createObjectURL(new Blob([raw], { type }));
      revoke(id);
      const timer = setTimeout(() => revoke(id), 120_000);
      saved.set(id, { url: blobUrl, bytes: raw, mime: type, timer });
      send({ id, kind: "done", blobUrl, filename, bytes: raw.length, meshCount, imageCount });
    } catch (err) {
      send({ id, kind: "error", error: String(err instanceof Error ? err.message : err) });
    } finally {
      inFlight.delete(id);
    }
  }

  /**
   * Handle one request; resolves to the reply (`{ ok: true }` acks a run).
   * @param {any} msg
   */
  async function handle(msg) {
    if (!msg || msg.target !== "offscreen") return undefined;

    if (msg.action === "run") {
      // A resend of a running job is acked, not rerun.
      if (!inFlight.has(msg.id)) {
        inFlight.add(msg.id);
        send({ id: msg.id, kind: "progress", phase: "queued", text: "Converter started", logKind: "info", depth: 1 });
        void runJob(msg.id, msg.url, {
          debugZip: msg.debugZip,
          exportFormat: msg.exportFormat,
          maxTextureEdge: msg.maxTextureEdge,
          includeViewerScene: msg.includeViewerScene,
          uidInFilename: msg.uidInFilename,
        });
      }
      return { ok: true };
    }

    if (msg.action === "refetchBytes") {
      const entry = saved.get(msg.id);
      return entry ? { ok: true, base64: bytesToBase64(entry.bytes), mime: entry.mime } : { ok: false };
    }

    if (msg.action === "revoke") {
      revoke(msg.id);
    }
    return undefined;
  }

  return { handle };
}

/** @param {Uint8Array} u8 */
function bytesToBase64(u8) {
  const chunk = 32768;
  let binary = "";
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}
