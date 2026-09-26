import { formatBytes } from "../lib/log-display.js";
import { savedHeadline } from "../lib/settings.js";
import { liveStatusLine } from "../lib/status-line.js";
import type { DownloadJob, JobPhase } from "./types";

export { formatBytes, formatBytesRange, humanizeLogText, logTone } from "../lib/log-display.js";
export { savedHeadline } from "../lib/settings.js";

/** A phase with work in flight: not idle, not terminal. */
type ActivePhase = Exclude<JobPhase, "idle" | "done" | "error">;

export function isInProgress(phase: JobPhase): phase is ActivePhase {
  return phase !== "idle" && phase !== "done" && phase !== "error";
}

const PHASE_LABELS: Record<ActivePhase, string> = {
  queued: "Queued",
  reading: "Reading viewer",
  decrypting: "Decrypting",
  textures: "Textures",
  packing: "Packing ORM",
  converting: "Converting",
  zipping: "Zipping",
  saving: "Saving",
};

export function statusLine(job: DownloadJob): string {
  if (job.phase === "queued") return "Queued";
  if (isInProgress(job.phase)) return liveStatusLine(job.log, PHASE_LABELS[job.phase], job.pct);
  if (job.phase === "done") {
    const zip = job.filename?.endsWith(".zip") ?? false;
    return [
      savedHeadline(job),
      job.bytes ? formatBytes(job.bytes) : null,
      !zip && job.meshCount != null ? `${job.meshCount} meshes` : null,
      !zip && job.imageCount != null ? `${job.imageCount} images` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (job.phase === "error") return job.error || "Download failed. Try again.";
  return "Ready";
}
