/**
 * Live one-line activity for the queue row and the page toast, built from the
 * newest open grouped log entry (see log-groups.js). Display only: `pct` is
 * still the phase-smoothed job percentage; no per-texture percentages.
 */
import { KEY_SCAN_GROUP, groupProgress, plural } from "./log-groups.js";

const EXTENSION = /\.[a-z0-9]{1,5}$/i;

/**
 * Shorten `text` to at most `max` chars by cutting the middle, keeping the
 * file extension (plus a few chars before it) visible: `gltf_emb…_12.png`.
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function middleTruncate(text, max = 24) {
  if (text.length <= max) return text;
  const keep = max - 1;
  const ext = text.match(EXTENSION)?.[0] ?? "";
  const tail = Math.min(keep - 1, Math.max(ext.length + 3, Math.floor(keep / 3)));
  return `${text.slice(0, keep - tail)}…${text.slice(text.length - tail)}`;
}

/**
 * Newest top-level grouped entry that is still open. Child rows (`parent`,
 * e.g. `texture:<base>`) are skipped; their parent row carries the summary.
 * @param {ReadonlyArray<{ group?: string, parent?: string, active?: boolean }> | undefined} log
 */
export function pickActiveGroup(log) {
  if (!log) return undefined;
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry.group && !entry.parent && entry.active !== false) return entry;
  }
  return undefined;
}

/**
 * Activity text for an open group, without the percentage. A parent row with
 * `total` shows `<text> <finished>/<total> · <oldest in-flight child>`,
 * computed from its child rows in `log`.
 * @param {{ group?: string, text: string, detail?: string, count?: number, total?: number, skipped?: number }} entry
 * @param {ReadonlyArray<{ parent?: string, active?: boolean, text: string }>} [log]
 * @returns {string}
 */
export function groupActivity(entry, log = []) {
  if (entry.group === KEY_SCAN_GROUP) {
    return join(`Decrypt key · ${plural(entry.count ?? 1, "script")}`, entry.detail);
  }
  if (entry.total !== undefined) {
    const { finished, total, inFlight } = groupProgress(entry, log.filter((e) => e.parent === entry.group));
    return join(`${entry.text} ${finished}/${total}`, inFlight[0]?.text);
  }
  return join(entry.text, entry.detail);
}

/**
 * @param {string} label
 * @param {string | undefined} detail middle-truncated; omitted when empty
 */
function join(label, detail) {
  const d = detail?.trim();
  return d ? `${label} · ${middleTruncate(d)}` : label;
}

/**
 * In-progress status line: `<activity or phase label> · <pct>%`.
 * @param {ReadonlyArray<Record<string, any>> | undefined} log
 * @param {string} phaseLabel fallback when no group is open
 * @param {number} pct
 * @returns {string}
 */
export function liveStatusLine(log, phaseLabel, pct) {
  const entry = pickActiveGroup(log);
  return `${entry ? groupActivity(entry, log) : phaseLabel} · ${Math.round(pct)}%`;
}
