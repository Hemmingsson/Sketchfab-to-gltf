import { browser } from "wxt/browser";
import {
  SETTINGS_KEY,
  parseSettings,
  type JobPatch,
  type JobUpdate,
  type UiReply,
  type UiRequest,
} from "./messages";
import { clearPageToastsIfDisabled } from "./job-toasts";
import { app, patchJob, upsertJob, type Backend } from "./store.svelte";
import type { DownloadJob } from "./types";

/** The reply type follows the request's action, so no caller can pick its own. */
function send<M extends UiRequest>(msg: M): Promise<UiReply[M["action"]] | undefined> {
  return browser.runtime.sendMessage(msg) as Promise<UiReply[M["action"]] | undefined>;
}

function enqueueDownload(url: string) {
  send({ action: "enqueueDownload", url }).catch(() => {});
}

/** History writes reply `{ ok }`; a false reply rejects so the store can roll back. */
async function sendOk(msg: Extract<UiRequest, { action: "clearHistory" | "restoreHistory" }>) {
  const reply = await send(msg);
  if (!reply?.ok) throw new Error("History update failed");
}

/** `lite`: finished jobs arrive without logs (content script; history can be hundreds of jobs). */
export async function loadJobs(lite = false) {
  const reply = await send({ action: "getJobs", lite });
  app.jobs = reply?.jobs ?? [];
}

export async function loadSettings() {
  const data = await browser.storage.local.get(SETTINGS_KEY);
  app.settings = parseSettings(data[SETTINGS_KEY]);
}

/** Keep `app.settings` in sync when the popup writes storage (content script toasts). */
export function watchSettings() {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[SETTINGS_KEY]) return;
    app.settings = parseSettings(changes[SETTINGS_KEY].newValue);
    clearPageToastsIfDisabled();
  });
}

/** Register once per context. The content script passes toastForJob. */
export function listenForJobs(onJob?: (job: DownloadJob) => void) {
  browser.runtime.onMessage.addListener((msg: unknown) => {
    const update = msg as JobUpdate | JobPatch | undefined;
    if (update?.type === "jobPatch") {
      const job = patchJob(update.id, update.pct, update.updatedAt);
      if (job) onJob?.(job);
      return;
    }
    if (update?.type !== "jobUpdate" || !update.job) return;
    upsertJob(update.job);
    onJob?.(update.job);
  });
}

export const chromeBackend: Backend = {
  enqueue: enqueueDownload,
  async enqueueCollection(uid) {
    const reply = await send({ action: "enqueueCollection", uid });
    if (!reply?.ok) throw new Error(reply?.error || "Could not list the collection");
  },
  retry(job) {
    enqueueDownload(job.url);
  },
  clearHistory() {
    return sendOk({ action: "clearHistory" });
  },
  restoreHistory(jobs) {
    return sendOk({ action: "restoreHistory", jobs });
  },
  saveSettings(settings) {
    browser.storage.local.set({ [SETTINGS_KEY]: settings }).catch(() => {});
  },
};
