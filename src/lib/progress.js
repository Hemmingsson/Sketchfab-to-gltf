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

/**
 * Phase after a pipeline line. Child rows (meta with `parent`, e.g. a texture
 * titled "saving.png") never reclassify the phase.
 * @param {string} text
 * @param {{ parent?: string } | undefined} meta
 * @param {string} prevPhase
 */
export function progressPhase(text, meta, prevPhase) {
  return meta?.parent ? prevPhase : mapPhase(text, prevPhase);
}

const HEADER_RULES = [
  [/^ERROR:/i, "error"],
  [/^Reading public viewer/i, "reading"],
  [/^(Extracting decrypt key|Loading WASM|Decrypting )/i, "decrypt"],
  [/^Downloading textures/i, "texture"],
  [/^Downloading /i, "download"],
  [/^Packing ORM/i, "pack"],
  [/^Converting /i, "convert"],
  [/^(Building ZIP|DEBUG: bundling)/i, "zip"],
];

export const LOG_CAP = 500;

export function classifyLine(line) {
  const text = String(line || "").trim();
  if (/^\s/.test(String(line || ""))) return { kind: "detail", depth: 1, text };

  for (const [pattern, kind] of HEADER_RULES) {
    if (pattern.test(text)) return { kind, depth: 0, text };
  }
  return { kind: "detail", depth: 1, text };
}

/** A status closes a grouped row; "done" also marks it finished. */
function setStatus(entry, status) {
  if (status === undefined) return;
  entry.status = status;
  entry.active = false;
  if (status === "done") entry.done = true;
}

/** Copy the defined optional fields (detail, total, width, …) onto `entry`. */
function assignDefined(entry, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) entry[key] = value;
  }
}

/**
 * Append a log entry, or upsert by `group`. The only place entries are
 * created, so ids stay unique.
 *
 * A grouped line updates the existing row in place (text, optional fields,
 * count + 1); kind, depth, id, position and `parent` belong to its first line.
 * Any `status` closes a grouped row. Non-grouped entries are settled first.
 *
 * @param {Array<Record<string, any>>} log
 * @param {{ kind: string, text?: string, depth?: number, group?: string, parent?: string, status?: "done" | "warn" | "error", [field: string]: unknown }} line
 * @param {boolean} [active]
 */
export function appendLog(log, { kind, text, depth = 0, group, parent, status, ...fields }, active = true) {
  settleLog(log);

  if (group) {
    const existing = log.find((entry) => entry.group === group);
    if (existing) {
      if (text !== undefined) existing.text = text;
      assignDefined(existing, fields);
      existing.count = (existing.count || 1) + 1;
      setStatus(existing, status);
      return existing;
    }
  }

  /** @type {Record<string, any>} */
  const entry = { id: crypto.randomUUID(), kind, text, depth, active, at: Date.now() };
  assignDefined(entry, fields);
  if (group) {
    entry.group = group;
    entry.count = 1;
    if (parent) entry.parent = parent;
    setStatus(entry, status);
  } else if (status !== undefined) {
    entry.status = status;
  }
  log.push(entry);

  if (log.length > LOG_CAP) {
    log.splice(0, log.length - LOG_CAP);
  }
  return entry;
}

/**
 * Close every grouped entry that is still active (e.g. when a job fails or
 * finishes). Entries already closed keep their status.
 *
 * @param {Array<Record<string, any>>} log
 * @param {"done" | "warn" | "error"} [status]
 */
export function closeOpenGroups(log, status = "done") {
  for (const entry of log) {
    if (entry.group && entry.active) setStatus(entry, status);
  }
}

/** Settle non-grouped entries: none active, nested details done. Grouped entries are left alone. */
export function settleLog(log) {
  for (const entry of log) {
    if (entry.group) continue;
    entry.active = false;
    if ((entry.depth || 0) > 0) entry.done = true;
  }
}
