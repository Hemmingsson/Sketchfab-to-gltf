/**
 * Display-only helpers for job log lines. Stored log text stays unchanged;
 * the UI runs lines through these before rendering.
 */

/** @param {number} n @returns {[string, "B" | "KB" | "MB"]} */
function scaleBytes(n) {
  if (n < 1024) return [String(n), "B"];
  if (n < 1024 * 1024) return [(n / 1024).toFixed(1), "KB"];
  return [(n / (1024 * 1024)).toFixed(1), "MB"];
}

/**
 * Human-readable size: `222 B`, `6.3 KB`, `4.6 MB`.
 * @param {number} n
 * @returns {string}
 */
export function formatBytes(n) {
  const [value, unit] = scaleBytes(n);
  return `${value} ${unit}`;
}

/**
 * Size change `a → b`; a shared unit is written once: `4.6 → 5.0 MB`, `900 B → 1.2 KB`.
 * @param {number} a
 * @param {number} b
 * @returns {string}
 */
export function formatBytesRange(a, b) {
  const [va, ua] = scaleBytes(a);
  const [vb, ub] = scaleBytes(b);
  return ua === ub ? `${va} → ${vb} ${ub}` : `${va} ${ua} → ${vb} ${ub}`;
}

const BYTE_COUNT = /\b(\d+) (?:bytes\b|B\b)/g;

/**
 * Rewrite raw byte counts (`4859221 bytes`, `6500 B`) as formatted sizes.
 * @param {string} text
 * @returns {string}
 */
export function humanizeLogText(text) {
  return text.replace(BYTE_COUNT, (_, digits) => formatBytes(Number(digits)));
}

const WARN_RULES = [/^NOTE:/, /\bWARN(?:ING)?\b/i, /look unusually small/i];
const DIM_RULES = [/^→/, /^diter\.b\b/, /pk=/, /WASM loaded/];

/**
 * Visual weight of a log line: warnings stand out, low-value detail recedes.
 * @param {string} text
 * @returns {"normal" | "dim" | "warn"}
 */
export function logTone(text) {
  const t = text.trimStart();
  if (WARN_RULES.some((re) => re.test(t))) return "warn";
  if (DIM_RULES.some((re) => re.test(t))) return "dim";
  return "normal";
}
