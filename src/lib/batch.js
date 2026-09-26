/**
 * Collection batches: many jobs queued by one click share `job.batch`
 * (`{ id, name, startedAt }`; id is the collection uid, startedAt marks the run).
 */

/** Same rule as isInProgress() in src/shared/format.ts. */
const SETTLED = new Set(["idle", "done", "error"]);

/**
 * Progress of the latest run of a batch, from the job list; null if none.
 * A model re-queued by a newer run belongs to that run only (one job per uid).
 */
export function batchProgress(jobs, batchId) {
  let startedAt = -1;
  for (const j of jobs) {
    if (j?.batch?.id === batchId && j.batch.startedAt > startedAt) startedAt = j.batch.startedAt;
  }
  if (startedAt < 0) return null;
  const run = jobs.filter((j) => j?.batch?.id === batchId && j.batch.startedAt === startedAt);
  const active = run.filter((j) => !SETTLED.has(j.phase));
  const current = active.find((j) => j.phase !== "queued");
  const saved = run.filter((j) => j.phase === "done").length;
  return {
    name: run[0].batch.name,
    startedAt,
    total: run.length,
    finished: run.length - active.length,
    saved,
    failed: run.length - active.length - saved,
    running: active.length > 0,
    current: current?.name ?? "",
  };
}

/** In-progress collection toast / button: "Downloading 12 of 607". */
export function batchBusyLine(progress) {
  return `Downloading ${progress.finished} of ${progress.total}`;
}

/** Downloads subfolder for a batch: the collection name, safe on every OS. */
export function batchFolder(name) {
  const safe = String(name || "")
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80)
    .trim();
  return safe || "Sketchfab collection";
}
