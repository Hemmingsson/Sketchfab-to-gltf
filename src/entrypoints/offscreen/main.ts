import { browser } from "wxt/browser";
import { downloadModel } from "../../lib/pipeline.js";
import { classifyLine, progressPhase } from "../../lib/progress.js";
import type { OffscreenEvent, OffscreenRequest, ProgressGroupMeta } from "../../shared/messages";
import type { JobPhase, LogKind, PipelineMeta } from "../../shared/types";

/** `Omit` per union arm: a plain `Omit<OffscreenEvent, "source">` would keep only the shared keys. */
type OmitPerArm<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type OffscreenEmit = OmitPerArm<OffscreenEvent, "source">;

/**
 * id -> object URL plus the bytes retained for the background's data-URL
 * fallback. Revoked together so a failed save does not pin a 4K pack forever.
 */
const saved = new Map<string, { url: string; bytes: Uint8Array; mime: string }>();
const inFlight = new Set<string>();

function emit(msg: OffscreenEmit) {
  browser.runtime.sendMessage({ source: "sf-offscreen", ...msg }).catch(() => {});
}

function bytesToBase64(buffer: Uint8Array | ArrayBuffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const chunk = 32768;
  let binary = "";
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function revoke(id: string) {
  const entry = saved.get(id);
  if (!entry) return;
  URL.revokeObjectURL(entry.url);
  saved.delete(id);
}

type RunOpts = Pick<
  Extract<OffscreenRequest, { action: "run" }>,
  "debugZip" | "exportFormat" | "maxTextureEdge" | "includeViewerScene" | "uidInFilename"
>;

async function runJob(id: string, url: string, opts: RunOpts) {
  let phase: JobPhase = "queued";

  const onProgress = (text: string, meta?: ProgressGroupMeta) => {
    phase = progressPhase(text, meta, phase) as JobPhase;
    const line = classifyLine(text) as { kind: LogKind; depth: number; text: string };
    emit({ id, kind: "progress", phase, text: line.text, logKind: line.kind, depth: line.depth, meta });
  };

  const onMeta = (meta: PipelineMeta) => {
    emit({ id, kind: "meta", ...meta });
  };

  try {
    const { filename, bytes, kind, meshCount, imageCount } = await downloadModel(url, onProgress, {
      ...opts,
      onMeta,
    });
    const type = kind === "glb" ? "model/gltf-binary" : "application/zip";
    const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const blob = new Blob([raw as Uint8Array<ArrayBuffer>], { type });
    const blobUrl = URL.createObjectURL(blob);
    saved.set(id, { url: blobUrl, bytes: raw, mime: type });
    setTimeout(() => revoke(id), 120_000);
    emit({ id, kind: "done", blobUrl, filename, bytes: raw.length, meshCount, imageCount });
  } catch (err) {
    emit({ id, kind: "error", error: String(err instanceof Error ? err.message : err) });
  } finally {
    inFlight.delete(id);
  }
}

browser.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
  const msg = raw as OffscreenRequest | undefined;
  if (!msg || msg.target !== "offscreen") return;

  if (msg.action === "run") {
    if (inFlight.has(msg.id)) return;
    inFlight.add(msg.id);
    void runJob(msg.id, msg.url, {
      debugZip: msg.debugZip,
      exportFormat: msg.exportFormat,
      maxTextureEdge: msg.maxTextureEdge,
      includeViewerScene: msg.includeViewerScene,
      uidInFilename: msg.uidInFilename,
    });
    return;
  }

  if (msg.action === "refetchBytes") {
    const entry = saved.get(msg.id);
    if (entry) {
      sendResponse({ ok: true, base64: bytesToBase64(entry.bytes), mime: entry.mime });
    } else {
      sendResponse({ ok: false });
    }
    return true;
  }

  if (msg.action === "revoke") {
    revoke(msg.id);
    return;
  }
});
