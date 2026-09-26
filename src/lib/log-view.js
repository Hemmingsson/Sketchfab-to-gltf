/**
 * Log detail view mode: `summary` (default) hides low-value lines and keeps
 * groups collapsed; `raw` is a plain terminal dump of every stored entry.
 * UI preference only; it never touches stored log entries.
 */
import { logTone } from "./log-display.js";

/** @typedef {"summary" | "raw"} LogView */

/**
 * @typedef {{
 *   text: string,
 *   depth?: number,
 *   detail?: string,
 *   status?: string,
 *   count?: number,
 *   width?: number,
 *   height?: number,
 *   inBytes?: number,
 *   outBytes?: number,
 * }} RawLogEntry
 */

export const LOG_VIEW_KEY = "sfd.logView";

/**
 * Parse a stored preference; anything unknown falls back to `summary`.
 * @param {unknown} value
 * @returns {LogView}
 */
export function parseLogView(value) {
  return value === "raw" ? "raw" : "summary";
}

/**
 * Whether a top-level log row shows in the given view. Summary hides dim-tone
 * lines; grouped rows and warn/error lines always stay.
 * @param {{ text: string, group?: string, status?: string, kind?: string }} entry
 * @param {LogView} view
 * @returns {boolean}
 */
export function isLogRowVisible(entry, view) {
  if (view === "raw") return true;
  if (entry.kind === "separator") return true;
  if (entry.group) return true;
  if (entry.kind === "error" || entry.status === "warn" || entry.status === "error") return true;
  return logTone(entry.text) !== "dim";
}

/**
 * One plain terminal line from a stored log entry (no humanizing).
 * @param {RawLogEntry} entry
 * @returns {string}
 */
export function formatRawLogLine(entry) {
  const depth = Math.max(0, entry.depth ?? 0);
  /** @type {string[]} */
  const bits = [entry.text];
  if (entry.detail) bits.push(entry.detail);
  if (entry.status) bits.push(entry.status);
  if (entry.width !== undefined || entry.height !== undefined) {
    bits.push(`${entry.width ?? "?"}x${entry.height ?? "?"}`);
  }
  if (entry.inBytes !== undefined || entry.outBytes !== undefined) {
    bits.push(`${entry.inBytes ?? "?"} → ${entry.outBytes ?? "?"} bytes`);
  }
  if ((entry.count ?? 0) > 1) bits.push(`×${entry.count}`);
  return `${"  ".repeat(depth)}${bits.join("  ")}`;
}

/**
 * Full raw log dump: one line per flat entry, joined with newlines.
 * @param {RawLogEntry[]} entries
 * @returns {string}
 */
export function formatRawLog(entries) {
  return entries.map(formatRawLogLine).join("\n");
}
