import { modelUid } from "../lib/model-url.js";
import { isInProgress } from "./format";
import { parseSettings } from "./messages";
import type { DownloadJob, Route, Settings } from "./types";
import { navigate } from "./view-transition";

export type Backend = {
  enqueue(url: string): void;
  /** Queue every model in a collection as one batch; rejects if the listing fails. */
  enqueueCollection(uid: string): Promise<void>;
  retry(job: DownloadJob): void;
  clearHistory(): Promise<void>;
  restoreHistory(jobs: DownloadJob[]): Promise<void>;
  saveSettings(settings: Settings): void;
};

let backend: Backend | null = null;

export function setBackend(next: Backend) {
  backend = next;
}

function api(): Backend {
  if (!backend) throw new Error("setBackend() must run before the UI mounts");
  return backend;
}

export const app = $state({
  route: { name: "list" } as Route,
  jobs: [] as DownloadJob[],
  settings: parseSettings(undefined),
  /** Model on the current page (content script / playground stage). */
  pageUid: null as string | null,
  pageUrl: "",
  /** Jobs removed by the last Clear history; non-null shows Undo in Settings. */
  cleared: null as DownloadJob[] | null,
});

export function upsertJob(job: DownloadJob) {
  const i = app.jobs.findIndex((j) => j.id === job.id);
  if (i === -1) app.jobs.unshift(job);
  else app.jobs[i] = job;
}

/** Apply a progress tick; undefined when the job is unknown (the next full update adds it). */
export function patchJob(id: string, pct: number, updatedAt: number): DownloadJob | undefined {
  const job = app.jobs.find((j) => j.id === id);
  if (!job) return undefined;
  job.pct = pct;
  job.updatedAt = updatedAt;
  return job;
}

function leaveSettings() {
  if (app.route.name === "settings") app.cleared = null;
}

export function goList() {
  const from = app.route;
  if (from.name === "list") return;
  const show = () => {
    leaveSettings();
    app.route = { name: "list" };
  };
  if (from.name === "detail") navigate("detail-close", show, from.jobId);
  else navigate("settings-close", show);
}

export function goSettings() {
  navigate("settings-open", () => {
    app.route = { name: "settings" };
  });
}

export function goDetail(jobId: string) {
  navigate(
    "detail-open",
    () => {
      leaveSettings();
      app.route = { name: "detail", jobId };
    },
    jobId
  );
}

export function selectedJob(): DownloadJob | null {
  const route = app.route;
  if (route.name !== "detail") return null;
  return app.jobs.find((j) => j.id === route.jobId) ?? null;
}

export function jobFor(uid: string | null): DownloadJob | null {
  if (!uid) return null;
  return app.jobs.find((j) => j.uid === uid) ?? null;
}

/** Queue a model page URL unless that model is already downloading. */
export function downloadModel(url: string) {
  const job = jobFor(modelUid(url));
  if (job && isInProgress(job.phase)) return;
  if (url) api().enqueue(url);
}

export function downloadCollection(uid: string) {
  return api().enqueueCollection(uid);
}

export function retryJob(jobId: string) {
  const job = app.jobs.find((j) => j.id === jobId);
  if (job) api().retry($state.snapshot(job));
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  app.settings[key] = value;
  api().saveSettings($state.snapshot(app.settings));
}

/** Append jobs whose id is not already listed; returns the ones added. */
function appendMissing(extra: DownloadJob[]) {
  const present = new Set(app.jobs.map((j) => j.id));
  const added = extra.filter((j) => !present.has(j.id));
  app.jobs = [...app.jobs, ...added];
  return added;
}

export async function clearHistory() {
  const removed = $state.snapshot(app.jobs.filter((j) => !isInProgress(j.phase)));
  if (removed.length === 0) return;
  app.cleared = removed;
  app.jobs = app.jobs.filter((j) => isInProgress(j.phase));
  try {
    await api().clearHistory();
  } catch {
    app.cleared = null;
    appendMissing(removed);
  }
}

export async function undoClearHistory() {
  if (!app.cleared) return;
  const cleared = $state.snapshot(app.cleared);
  app.cleared = null;
  const jobs = appendMissing(cleared);
  try {
    await api().restoreHistory(jobs);
  } catch {
    const restored = new Set(jobs.map((j) => j.id));
    app.jobs = app.jobs.filter((j) => !restored.has(j.id));
    app.cleared = cleared;
  }
}
