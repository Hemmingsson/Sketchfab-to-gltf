/**
 * Grouped progress lines. The pipeline calls `onProgress(text, meta)`; a line
 * whose meta carries `group` updates that log row in place, and any `status`
 * closes it (see appendLog in progress.js).
 *
 * Group keys: "key-scan", "textures" (parent) and "texture:<base>" (child).
 */

/**
 * @typedef {{
 *   group?: string, parent?: string, detail?: string, status?: "done" | "warn" | "error",
 *   total?: number, skipped?: number, width?: number, height?: number, inBytes?: number, outBytes?: number
 * }} ProgressMeta
 * @typedef {(text: string, meta?: ProgressMeta) => void} OnProgress
 */

export const KEY_SCAN_GROUP = "key-scan";
const TEXTURES_GROUP = "textures";

/** @param {string} base */
function textureGroup(base) {
  return `texture:${base}`;
}

/**
 * `1 script`, `2 scripts`.
 * @param {number} n
 * @param {string} word
 */
export function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * One probe of a viewer script while looking for the static key.
 * @param {string} name script file name
 * @returns {[string, ProgressMeta]}
 */
export function keyScanProbe(name) {
  return ["Extracting decrypt key", { group: KEY_SCAN_GROUP, detail: name }];
}

/**
 * Close the key-scan row. `source` is "scan" when a script held the key,
 * "stored" / "default" when the scan failed and a fallback key is used.
 * @param {string} key
 * @param {number} probes scripts read
 * @param {"scan" | "stored" | "default"} [source]
 * @returns {[string, ProgressMeta]}
 */
export function keyScanDone(key, probes, source = "scan") {
  const text = `Decrypt key ${String(key).slice(0, 8)}…`;
  const scripts = plural(probes, "script");
  if (source === "scan") return [text, { group: KEY_SCAN_GROUP, detail: scripts, status: "done" }];
  const fallback = source === "stored" ? "stored key" : "built-in key";
  return [text, { group: KEY_SCAN_GROUP, detail: `${scripts} · ${fallback}`, status: "warn" }];
}

/**
 * Live progress of a parent row (e.g. `textures`) from its child rows: rows
 * that closed plus skipped maps count as finished; open rows are in flight,
 * oldest first.
 * @template {{ active?: boolean }} T
 * @param {{ total?: number, skipped?: number }} parent
 * @param {ReadonlyArray<T>} children
 */
export function groupProgress(parent, children) {
  const inFlight = children.filter((child) => child.active);
  return {
    finished: children.length - inFlight.length + (parent.skipped ?? 0),
    total: Math.max(parent.total ?? 0, children.length),
    inFlight,
  };
}

/**
 * Tracks one texture download batch and emits grouped lines: a parent
 * "textures" row (at open, per skipped map and at finish) plus one
 * "texture:<base>" row per map. Live progress is derived from the child rows
 * (see groupProgress). Pure apart from the `onProgress` calls.
 *
 * @param {number} total
 * @param {OnProgress | undefined} onProgress
 */
export function createTextureLog(total, onProgress) {
  const emit = onProgress || (() => {});
  const counts = { descrambled: 0, passthrough: 0, failed: 0 };
  let skipped = 0;
  /** @type {Map<string, number>} */
  const seen = new Map();

  emit("Textures", { group: TEXTURES_GROUP, total });

  return {
    counts,

    /** A texture without a usable image: counts as finished, no row. */
    skip() {
      emit("Textures", { group: TEXTURES_GROUP, skipped: ++skipped });
    },

    /** @param {string} base sanitized file name; a repeated name gets group "texture:<base>#2" etc. */
    start(base) {
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      const group = n === 1 ? textureGroup(base) : `${textureGroup(base)}#${n}`;
      let lastWarn = "";
      /** @param {Omit<ProgressMeta, "group" | "parent">} meta */
      const line = (meta) => emit(base, { group, parent: TEXTURES_GROUP, ...meta });

      line({ detail: "fetching" });

      return {
        /** Detail-only update; a "warn" is remembered and closes the row as warn. */
        step(detail, status) {
          if (status === "warn") lastWarn = detail;
          line({ detail });
        },

        /** Callback for descrambleImageBytes: its raw lines become detail updates. */
        progress(raw) {
          line({ detail: String(raw || "").trim() });
        },

        /**
         * @param {{ width?: number, height?: number, inBytes: number, outBytes: number, fromDescramble: boolean, pk?: unknown }} info
         */
        done({ width, height, inBytes, outBytes, fromDescramble, pk }) {
          if (fromDescramble) counts.descrambled++;
          else counts.passthrough++;
          const detail = lastWarn || (fromDescramble ? `pk=${pk}` : "passthrough");
          line({ detail, status: lastWarn ? "warn" : "done", width, height, inBytes, outBytes });
        },

        /** The texture is dropped (not in the GLB). */
        fail(detail, status = "error") {
          counts.failed++;
          line({ detail, status });
        },
      };
    },

    /** Close the parent row with a summary. */
    finish(status = "done") {
      const parts = [plural(total, "map"), `${counts.descrambled} descrambled`, `${counts.passthrough} passthrough`];
      if (counts.failed) parts.push(`${counts.failed} failed`);
      emit("Textures", { group: TEXTURES_GROUP, detail: parts.join(" · "), status });
    },
  };
}
