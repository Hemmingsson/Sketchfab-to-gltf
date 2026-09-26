import { toast } from "svelte-sonner";
import { batchBusyLine, batchProgress } from "../lib/batch.js";
import { modelUid } from "../lib/model-url.js";
import ToastThumb from "../components/ToastThumb.svelte";
import { isInProgress, savedHeadline, statusLine } from "./format";
import { app } from "./store.svelte";
import type { DownloadJob, JobBatch } from "./types";

/** Loading toast id per job (or per batch run), or "dismissed" once the user closed it: no further toasts for that run. */
const toasts = new Map<string, string | number | "dismissed">();

function dismissTracked(jobId: string) {
  const id = toasts.get(jobId);
  if (id !== undefined && id !== "dismissed") toast.dismiss(id);
  toasts.delete(jobId);
}

/** Drop any open page toasts when the setting is off (storage change or playground toggle). */
export function clearPageToastsIfDisabled() {
  if (app.settings.pageToasts) return;
  for (const jobId of [...toasts.keys()]) dismissTracked(jobId);
}

/** `og:image` / twitter image from the open page head, only when it matches this job's model. */
function pageMetaImage(job: DownloadJob): string {
  if (typeof document === "undefined") return "";
  const page = modelUid(location.href);
  if (!page || page !== job.uid) return "";
  return (
    document.querySelector('meta[property="og:image"]')?.getAttribute("content")?.trim() ||
    document.querySelector('meta[name="twitter:image"]')?.getAttribute("content")?.trim() ||
    ""
  );
}

function toastImage(job: DownloadJob): string {
  return pageMetaImage(job) || job.thumbUrl || "";
}

/** CSS vars for ToastThumb (icon reads inherited `--toast-*` from the toast root). */
function thumbOptions(imageUrl: string, pct: number) {
  if (!imageUrl) return { icon: undefined, class: "", style: "" };
  const p = Math.min(1, Math.max(0, pct / 100));
  return {
    icon: ToastThumb,
    class: "toast-with-thumb",
    style: `--toast-thumb: url(${JSON.stringify(imageUrl)}); --toast-pct: ${p}`,
  };
}

/**
 * One loading toast per job, resolved to success/error. Call only for live updates, never for history loads.
 *
 * Re-calling `toast.loading` with the same id updates the mounted toast in place (no remount, the
 * spinner keeps running). The loading toast never auto-closes: updates stop while a phase sits at its
 * ceiling, and a 4 s auto-close followed by the next update would pop the toast in again.
 * success/error reset `duration` and `onDismiss` because sonner merges options into the existing toast.
 */
export function toastForJob(job: DownloadJob) {
  if (!app.settings.pageToasts) {
    dismissTracked(job.batch ? batchKey(job.batch) : job.id);
    return;
  }
  if (job.batch) {
    toastForBatch(job.batch);
    return;
  }
  const id = toasts.get(job.id);
  if (id === "dismissed") {
    if (!isInProgress(job.phase)) toasts.delete(job.id);
    return;
  }
  if (isInProgress(job.phase)) {
    // A batch queues many jobs at once: a waiting job gets its toast when it starts.
    const waiting = job.phase === "queued" && app.jobs.some((j) => j.id !== job.id && isInProgress(j.phase));
    if (id === undefined && waiting) return;
    toasts.set(
      job.id,
      toast.loading(statusLine(job), {
        id,
        description: job.name,
        duration: Number.POSITIVE_INFINITY,
        onDismiss: () => toasts.set(job.id, "dismissed"),
        ...thumbOptions(toastImage(job), job.pct),
      }),
    );
    return;
  }
  if (id === undefined) return;
  toasts.delete(job.id);
  // Clear thumb icon/CSS so success/error use the default type icons.
  const settled = { id, duration: undefined, onDismiss: undefined, icon: undefined, class: "", style: "" };
  if (job.phase === "done") toast.success(savedHeadline(job), { ...settled, description: job.name });
  else if (job.phase === "error") toast.error("Download failed", { ...settled, description: job.error || job.name });
}

function batchKey(batch: JobBatch) {
  return `batch:${batch.id}:${batch.startedAt}`;
}

/** One toast for a whole collection run: "Downloading 12 of 607", then one summary. */
function toastForBatch(batch: JobBatch) {
  const p = batchProgress(app.jobs, batch.id);
  // A late update from an older run of the same collection.
  if (!p || p.startedAt !== batch.startedAt) return;
  const key = batchKey(batch);
  const id = toasts.get(key);
  if (id === "dismissed") {
    if (!p.running) toasts.delete(key);
    return;
  }
  if (p.running) {
    toasts.set(
      key,
      toast.loading(batchBusyLine(p), {
        id,
        description: p.current ? `${p.name} · ${p.current}` : p.name,
        duration: Number.POSITIVE_INFINITY,
        onDismiss: () => toasts.set(key, "dismissed"),
      }),
    );
    return;
  }
  if (id === undefined) return;
  toasts.delete(key);
  const settled = { id, duration: undefined, onDismiss: undefined };
  const failed = p.failed ? ` · ${p.failed} failed` : "";
  if (p.saved === 0) toast.error("Collection download failed", { ...settled, description: p.name });
  else toast.success(`Saved ${p.saved} of ${p.total} models`, { ...settled, description: `${p.name}${failed}` });
}
