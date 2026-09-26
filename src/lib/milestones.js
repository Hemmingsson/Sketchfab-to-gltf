/**
 * Stage milestones: one `separator` log entry when a pipeline stage ends, e.g.
 * `Decrypted · 2.3s`, `Textures ready · 6.8s`, `GLB built · 43.9 MB · 1.9s`.
 * Phases are `JobPhase` strings (src/shared/types.ts).
 */
import { formatBytes } from "./log-display.js";

/** Stages that get a milestone when they end, and its label. */
const STAGE_LABELS = {
  decrypting: "Decrypted",
  textures: "Textures ready",
  converting: "GLB built",
};

/** True when entering this phase should start a stage timer. */
export function isMilestoneStage(phase) {
  return Object.prototype.hasOwnProperty.call(STAGE_LABELS, phase);
}

/**
 * Phases that do not end a stage: a failure, a reset, or (for `zipping`) the
 * raw-mesh fallback ZIP, where no GLB was built.
 */
const NO_MILESTONE = new Set(["error", "idle", "queued", "zipping"]);

/** Duration with one decimal: `2.3s`. */
function formatSeconds(ms) {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

/**
 * Separator entry for the stage that ends on `prevPhase → nextPhase`, or null.
 * `bytes` is shown only when given (a size the job already knows).
 * @param {string} prevPhase
 * @param {string} nextPhase
 * @param {{ startedAt: number, now: number, bytes?: number }} timing
 * @returns {{ kind: "separator", text: string } | null}
 */
export function stageMilestone(prevPhase, nextPhase, { startedAt, now, bytes }) {
  if (prevPhase === nextPhase || NO_MILESTONE.has(nextPhase)) return null;
  const label = STAGE_LABELS[/** @type {keyof typeof STAGE_LABELS} */ (prevPhase)];
  if (!label) return null;
  const bits = [label];
  if (typeof bytes === "number" && bytes > 0) bits.push(formatBytes(bytes));
  bits.push(formatSeconds(now - startedAt));
  return { kind: "separator", text: bits.join(" · ") };
}
