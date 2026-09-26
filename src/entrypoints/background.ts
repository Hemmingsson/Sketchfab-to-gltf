import { defineBackground } from "#imports";
import { browser, type Browser } from "wxt/browser";
import { batchFolder } from "../lib/batch.js";
import { collectionModelUrls } from "../lib/collection.js";
import { modelUid } from "../lib/model-url.js";
import { isMilestoneStage, stageMilestone } from "../lib/milestones.js";
import { appendLog, closeOpenGroups, settleLog } from "../lib/progress.js";
import { isInProgress } from "../shared/format";
import {
  HISTORY_KEY,
  SESSION_KEY,
  SETTINGS_KEY,
  parseSettings,
  type EnqueueCollectionReply,
  type EnqueueReply,
  type GetJobsReply,
  type JobPatch,
  type JobUpdate,
  type OffscreenEvent,
  type OffscreenRequest,
  type UiRequest,
} from "../shared/messages";
import type { DownloadJob, JobBatch, JobPhase, Settings } from "../shared/types";

/** Background-only per-job state; never broadcast or stored. */
type JobState = {
  /** Tabs whose page button should follow this job. */
  tabs: Set<number>;
  lastEventAt: number;
  /** When the current milestone stage (decrypting / textures / converting) began. */
  stageStartedAt?: number;
  saveAs?: boolean;
  fallbackTried?: boolean;
  /** URL and id of the save in flight (blob URL, then the data-URL fallback). */
  url?: string;
  downloadId?: number;
};

export default defineBackground({
  type: "module",
  main() {
    const KEEPALIVE_MS = 20000;
    /** A running job with no offscreen event for this long is treated as hung. */
    const STALL_MS = 5 * 60_000;
    const PHASE_CEIL: Record<Exclude<JobPhase, "idle">, number> = {
      queued: 0,
      reading: 8,
      decrypting: 18,
      textures: 60,
      packing: 75,
      converting: 90,
      zipping: 95,
      saving: 99,
      done: 100,
      error: 100,
    };
    const SMOOTH_MS = 150;
    const MIRROR_MS = 1000;

    /** uid -> active job (queued or running). */
    const jobs = new Map<string, DownloadJob>();
    /** Same keys as `jobs`: created in enqueue, deleted in endJob. */
    const states = new Map<string, JobState>();
    const queue: string[] = [];
    /** uid of the one job the offscreen document is working on (single-flight). */
    let current: string | null = null;
    let keepTimer: ReturnType<typeof setInterval> | undefined;
    let smoothTimer: ReturnType<typeof setInterval> | undefined;
    let mirrorTimer: ReturnType<typeof setTimeout> | undefined;

    function broadcast(msg: unknown) {
      browser.runtime.sendMessage(msg).catch(() => {});
    }

    /** Popup and the tabs following this job. */
    function sendToFollowers(job: DownloadJob, update: JobUpdate | JobPatch) {
      broadcast(update);
      for (const tabId of states.get(job.uid)?.tabs ?? []) {
        browser.tabs.sendMessage(tabId, update).catch(() => {});
      }
      updateBadge();
    }

    function broadcastJob(job: DownloadJob) {
      job.updatedAt = Date.now();
      sendToFollowers(job, { type: "jobUpdate", job });
    }

    /** Smoother tick: pct only, so the log is not re-sent every SMOOTH_MS. */
    function broadcastPct(job: DownloadJob) {
      job.updatedAt = Date.now();
      sendToFollowers(job, { type: "jobPatch", id: job.id, pct: job.pct, updatedAt: job.updatedAt });
    }

    function startSmoother() {
      if (smoothTimer) return;
      smoothTimer = setInterval(() => {
        if (jobs.size === 0) {
          stopSmoother();
          return;
        }
        for (const job of jobs.values()) {
          if (!isInProgress(job.phase)) continue;
          const ceil = PHASE_CEIL[job.phase];
          if (job.pct < ceil - 0.5) {
            const shown = Math.round(job.pct);
            job.pct = Math.min(ceil - 0.5, job.pct + Math.max(0.4, (ceil - job.pct) * 0.06));
            // The UI rounds pct; skip ticks that would not change what it shows.
            if (Math.round(job.pct) !== shown) broadcastPct(job);
          }
        }
      }, SMOOTH_MS);
    }

    function stopSmoother() {
      if (!smoothTimer) return;
      clearInterval(smoothTimer);
      smoothTimer = undefined;
    }

    function updateBadge() {
      if (jobs.size === 0) {
        clearBadge();
        return;
      }
      let pct = 0;
      for (const job of jobs.values()) {
        if (job.pct > pct) pct = job.pct;
      }
      const rounded = Math.round(pct);
      browser.action.setBadgeText({ text: rounded > 0 ? String(rounded) : String(jobs.size) }).catch(() => {});
    }

    function clearBadge() {
      browser.action.setBadgeText({ text: "" }).catch(() => {});
    }

    function mirrorSession() {
      clearTimeout(mirrorTimer);
      mirrorTimer = undefined;
      const list = Array.from(jobs.values());
      browser.storage.session.set({ [SESSION_KEY]: list }).catch(() => {});
    }

    /**
     * Progress lines arrive per texture; coalesce their mirror writes. Rehydrate only needs which jobs
     * were live, so a worker killed inside the window loses a few log lines, never a job.
     */
    function mirrorSessionSoon() {
      mirrorTimer ??= setTimeout(mirrorSession, MIRROR_MS);
    }

    function startKeepAlive() {
      if (keepTimer) return;
      keepTimer = setInterval(() => {
        browser.runtime.getPlatformInfo().catch(() => {});
        checkStalled().catch(() => {});
      }, KEEPALIVE_MS);
    }

    function stopKeepAlive() {
      if (!keepTimer) return;
      clearInterval(keepTimer);
      keepTimer = undefined;
    }

    async function readHistory(): Promise<DownloadJob[]> {
      try {
        const data = await browser.storage.local.get(HISTORY_KEY);
        const list = data[HISTORY_KEY];
        return Array.isArray(list) ? (list as DownloadJob[]) : [];
      } catch {
        return [];
      }
    }

    async function writeHistory(jobsToWrite: DownloadJob[]) {
      await browser.storage.local.set({ [HISTORY_KEY]: jobsToWrite });
    }

    async function appendHistory(job: DownloadJob) {
      const history = await readHistory();
      const next = [job, ...history.filter((h) => h && h.id !== job.id)];
      await writeHistory(next);
    }

    async function readSettings(): Promise<Settings> {
      try {
        const data = await browser.storage.local.get(SETTINGS_KEY);
        return parseSettings(data[SETTINGS_KEY]);
      } catch {
        return parseSettings(undefined);
      }
    }

    async function offscreenAlive() {
      if (!browser.runtime.getContexts) return true;
      const contexts = await browser.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
      return contexts.length > 0;
    }

    /**
     * The pipeline reports nothing if the offscreen document crashes or hangs,
     * which would wedge the single-flight queue. Fail the job and close the
     * document so a hung pipeline cannot overlap the next job.
     */
    async function checkStalled() {
      const job = current ? jobs.get(current) : undefined;
      if (!job || job.phase === "saving") return;
      const silentMs = Date.now() - states.get(job.uid)!.lastEventAt;
      // Grace period: the document may still be starting up.
      const gone = silentMs > KEEPALIVE_MS && !(await offscreenAlive());
      if (!gone && silentMs < STALL_MS) return;
      if (current !== job.uid) return;
      // Close before failing: failJob starts the next job, which must get a fresh document.
      await browser.offscreen.closeDocument().catch(() => {});
      // A late "done" may have moved it to saving; that save fails on its own now the blob is gone.
      if (jobs.get(job.uid)?.phase !== "saving") {
        failJob(job, gone ? "Converter closed unexpectedly" : "Converter stopped responding");
      }
    }

    async function ensureOffscreen() {
      try {
        await browser.offscreen.createDocument({
          url: "offscreen.html",
          reasons: ["BLOBS"],
          justification:
            "Decrypt model binaries and descramble textures off the service worker heap (4K packs OOM the SW).",
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (/already exists|duplicate|single offscreen/i.test(message)) return;
        throw e;
      }
    }

    function enqueue(uid: string, url: string, tabId?: number, batch?: JobBatch) {
      if (jobs.has(uid)) {
        if (tabId !== undefined) states.get(uid)!.tabs.add(tabId);
        return uid;
      }

      const now = Date.now();
      const job: DownloadJob = {
        id: uid,
        uid,
        url,
        name: "Sketchfab model",
        thumbUrl: "",
        phase: "queued",
        pct: 0,
        error: "",
        filename: "",
        bytes: 0,
        log: [],
        batch,
        createdAt: now,
        updatedAt: now,
      };
      appendLog(job.log, { kind: "queued", text: "Added to queue" });
      jobs.set(uid, job);
      states.set(uid, { tabs: new Set(tabId === undefined ? [] : [tabId]), lastEventAt: now });
      if (!queue.includes(uid)) queue.push(uid);
      mirrorSession();
      broadcastJob(job);
      runNext();
      return uid;
    }

    async function runNext() {
      if (current) return;
      const uid = queue.shift();
      if (!uid) {
        stopKeepAlive();
        clearBadge();
        return;
      }

      const job = jobs.get(uid);
      if (!job) {
        runNext();
        return;
      }

      current = uid;
      states.get(uid)!.lastEventAt = Date.now();
      startKeepAlive();
      try {
        const settings = await readSettings();
        await ensureOffscreen();
        const msg: OffscreenRequest = {
          target: "offscreen",
          action: "run",
          id: uid,
          url: job.url,
          debugZip: settings.debugZip,
          exportFormat: settings.exportFormat,
          maxTextureEdge: settings.maxTextureEdge,
          includeViewerScene: settings.includeViewerScene,
          uidInFilename: settings.uidInFilename,
        };
        await browser.runtime.sendMessage(msg);
      } catch (e) {
        failJob(job, e instanceof Error ? e.message : String(e));
      }
    }

    /** A late callback for a job that already ended must not touch the queue. */
    function isLive(job: DownloadJob) {
      return jobs.get(job.uid) === job;
    }

    /**
     * Move `job.phase` to `next`. Leaving decrypting / textures / converting
     * appends one milestone separator; entering those stages starts the timer.
     */
    function advancePhase(job: DownloadJob, next: JobPhase, bytes?: number) {
      const st = states.get(job.uid);
      if (!st) {
        job.phase = next;
        return;
      }
      const prev = job.phase;
      if (prev === next) return;
      const now = Date.now();
      const entry = stageMilestone(prev, next, {
        startedAt: st.stageStartedAt ?? now,
        now,
        bytes,
      });
      if (entry) appendLog(job.log, entry);
      job.phase = next;
      if (isMilestoneStage(next)) st.stageStartedAt = now;
    }

    function failJob(job: DownloadJob, message: string) {
      if (!isLive(job)) return;
      job.phase = "error";
      job.pct = 100;
      job.error = String(message || "Download failed");
      closeOpenGroups(job.log, "error");
      settleLog(job.log);
      const last = job.log[job.log.length - 1];
      if (!last || last.kind !== "error") {
        appendLog(job.log, { kind: "error", text: job.error }, false);
      }
      endJob(job);
    }

    /** Terminal phase reached: drop the job, push the final update, then free the queue. */
    function endJob(job: DownloadJob) {
      jobs.delete(job.uid);
      mirrorSession();
      broadcastJob(job);
      states.delete(job.uid);
      // History first, so the next job's write cannot interleave with this read-modify-write.
      appendHistory(job)
        .catch(() => {})
        .then(() => {
          revokeOffscreen(job.uid);
          if (current === job.uid) current = null;
          runNext();
        });
    }

    async function saveJob(
      job: DownloadJob,
      blobUrl: string,
      filename: string,
      bytes: number,
      meshCount: number,
      imageCount: number,
    ) {
      // converting → saving is the GLB-built milestone (bytes known from offscreen done).
      advancePhase(job, "saving", bytes > 0 ? bytes : undefined);
      job.filename = filename || job.filename || "3d_model.glb";
      job.bytes = bytes;
      job.meshCount = meshCount;
      job.imageCount = imageCount;
      appendLog(job.log, { kind: "save", text: `Saving ${job.filename}…` });

      const st = states.get(job.uid)!;
      // A batch would open one Save dialog per model: it goes to Downloads/<collection>/ instead.
      st.saveAs = job.batch ? false : (await readSettings()).askWhereToSave;
      if (!isLive(job)) return;
      st.url = blobUrl;
      mirrorSession();
      broadcastJob(job);

      browser.downloads
        .download({ url: blobUrl, filename: savePath(job), saveAs: st.saveAs })
        .then((id) => {
          st.downloadId = id;
          st.url = undefined;
        })
        .catch((e: unknown) => {
          tryDataUrlFallback(job, e instanceof Error ? e.message : "Download did not start");
        });
    }

    /** Path under Downloads; `job.filename` stays the bare name shown in the UI. */
    function savePath(job: DownloadJob) {
      return job.batch ? `${batchFolder(job.batch.name)}/${job.filename}` : job.filename!;
    }

    /** Called at most once per job: from saveJob's rejected download, or onChanged when not yet tried. */
    function tryDataUrlFallback(job: DownloadJob, reason: string) {
      const st = states.get(job.uid);
      if (!st) return;
      st.fallbackTried = true;
      const giveUp = (message?: string) => failJob(job, message || reason || "Download failed");

      const msg: OffscreenRequest = { target: "offscreen", action: "refetchBytes", id: job.uid };
      browser.runtime
        .sendMessage(msg)
        .then(async (resp: { ok?: boolean; base64?: string; mime?: string } | undefined) => {
          if (!resp?.ok || !resp.base64 || !isLive(job) || job.phase !== "saving") {
            giveUp(reason);
            return;
          }
          const dataUrl = `data:${resp.mime || "application/octet-stream"};base64,${resp.base64}`;
          // Match by URL only until the id is known; do not keep the base64 alive for the whole save.
          st.url = dataUrl;
          st.downloadId = await browser.downloads.download({ url: dataUrl, filename: savePath(job), saveAs: st.saveAs });
          st.url = undefined;
        })
        .catch((e: unknown) => {
          giveUp(e instanceof Error ? e.message : reason);
        });
    }

    function revokeOffscreen(id: string) {
      const msg: OffscreenRequest = { target: "offscreen", action: "revoke", id };
      broadcast(msg);
    }

    function finishSave(job: DownloadJob, state: string, bytes: number) {
      if (!isLive(job)) return;
      const ok = state === "complete";
      job.phase = ok ? "done" : "error";
      if (ok) job.pct = 100;
      else job.error = job.error || "Download interrupted";
      if (bytes > 0) job.bytes = bytes;
      closeOpenGroups(job.log, ok ? "done" : "error");
      appendLog(
        job.log,
        ok ? { kind: "done", text: `Saved ${job.filename || "3d_model.glb"}` } : { kind: "error", text: job.error },
        false,
      );

      endJob(job);
    }

    /** The saving job this download belongs to; other downloads are the user's own. */
    function jobForDownload(id: number, url: string | undefined) {
      for (const [uid, st] of states) {
        const job = jobs.get(uid);
        if (job?.phase !== "saving") continue;
        if (st.downloadId === id || (url && st.url === url)) return { job, st };
      }
      return null;
    }

    function handleOffscreen(msg: OffscreenEvent) {
      const job = jobs.get(msg.id);
      if (!job) return;
      states.get(job.uid)!.lastEventAt = Date.now();

      if (msg.kind === "progress") {
        advancePhase(job, msg.phase);
        appendLog(job.log, { kind: msg.logKind, text: msg.text, depth: msg.depth, ...msg.meta });
        startSmoother();
        mirrorSessionSoon();
        broadcastJob(job);
        return;
      }

      if (msg.kind === "meta") {
        job.name = msg.name || job.name;
        job.thumbUrl = msg.thumbUrl || "";
        mirrorSession();
        broadcastJob(job);
        return;
      }

      if (msg.kind === "done") {
        closeOpenGroups(job.log);
        saveJob(job, msg.blobUrl, msg.filename, msg.bytes, msg.meshCount, msg.imageCount).catch((e: unknown) => {
          failJob(job, e instanceof Error ? e.message : String(e));
        });
        return;
      }

      if (msg.kind === "error") {
        failJob(job, msg.error);
      }
    }

    browser.downloads.onChanged.addListener((delta: Browser.downloads.DownloadDelta) => {
      if (!delta?.state) return;
      const state = delta.state.current;
      if (state !== "complete" && state !== "interrupted") return;
      if (![...jobs.values()].some((j) => j.phase === "saving")) return;

      browser.downloads.search({ id: delta.id }).then((items) => {
        const item = items?.[0];
        // The URL match covers a completion that lands before download() resolves.
        const match = jobForDownload(delta.id, item?.url);
        if (!match) return;
        const { job, st } = match;
        const bytes = item ? item.fileSize || item.totalBytes || 0 : 0;
        if (state === "interrupted") {
          if (item?.error === "USER_CANCELED") {
            job.error = "Save canceled";
            finishSave(job, state, bytes);
            return;
          }
          if (st.saveAs || st.fallbackTried) {
            finishSave(job, state, bytes);
            return;
          }
          tryDataUrlFallback(job, "Download interrupted");
          return;
        }
        finishSave(job, state, bytes);
      }).catch(() => {});
    });

    browser.runtime.onMessage.addListener(
      (raw: unknown, sender: Browser.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
        const msg = raw as Partial<UiRequest & OffscreenEvent> | undefined;
        if (!msg) return false;

        if (msg.source === "sf-offscreen") {
          handleOffscreen(msg as OffscreenEvent);
          return false;
        }

        if (msg.action === "enqueueDownload") {
          const url = typeof msg.url === "string" ? msg.url : "";
          const uid = modelUid(url);
          if (uid) {
            const reply: EnqueueReply = { ok: true, id: enqueue(uid, url, sender.tab?.id) };
            sendResponse(reply);
          }
          return false;
        }

        if (msg.action === "enqueueCollection") {
          const tabId = sender.tab?.id;
          const fetchJson = async (url: string) => {
            const resp = await fetch(url, { credentials: "omit" });
            if (!resp.ok) throw new Error(`HTTP ${resp.status} listing the collection`);
            return resp.json();
          };
          const uid = String(msg.uid || "");
          const name = fetchJson(`https://sketchfab.com/i/collections/${uid}`)
            .then((info) => String(info?.name || ""))
            .catch(() => "");
          Promise.all([name, collectionModelUrls(uid, fetchJson)])
            .then(([name, urls]) => {
              const batch: JobBatch = { id: uid, name: name || "Sketchfab collection", startedAt: Date.now() };
              const uids = urls.flatMap((url) => {
                const modelId = modelUid(url);
                return modelId ? [enqueue(modelId, url, tabId, batch)] : [];
              });
              const reply: EnqueueCollectionReply = { ok: true, uids };
              sendResponse(reply);
            })
            .catch((e: unknown) => {
              const reply: EnqueueCollectionReply = { ok: false, error: e instanceof Error ? e.message : String(e) };
              sendResponse(reply);
            });
          return true;
        }

        if (msg.action === "getJobs") {
          readHistory().then((history) => {
            const active = Array.from(jobs.values());
            const seen = new Set(active.map((j) => j.id));
            const past = history.filter((h) => h && !seen.has(h.id));
            const slim = msg.lite ? past.map((h) => ({ ...h, log: [] })) : past;
            const reply: GetJobsReply = { ok: true, jobs: [...active, ...slim] };
            sendResponse(reply);
          }).catch(() => {
            const reply: GetJobsReply = { ok: true, jobs: Array.from(jobs.values()) };
            sendResponse(reply);
          });
          return true;
        }

        if (msg.action === "clearHistory") {
          writeHistory([]).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
          return true;
        }

        if (msg.action === "restoreHistory") {
          const incoming = Array.isArray(msg.jobs) ? msg.jobs : [];
          readHistory().then((history) => {
            const seen = new Set<string>([...history.map((j) => j.id), ...Array.from(jobs.keys())]);
            const restored = incoming.filter((job) => job && !seen.has(job.id));
            const next = [...history, ...restored]
              .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            return writeHistory(next);
          }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
          return true;
        }

        return false;
      },
    );

    (async function rehydrate() {
      try {
        const data = await browser.storage.session.get(SESSION_KEY);
        const list = data[SESSION_KEY];
        if (!Array.isArray(list)) return;
        let orphaned = false;
        for (const stored of list as DownloadJob[]) {
          // A job enqueued while this ran is live, not stale.
          if (!stored?.uid || jobs.has(stored.uid)) continue;
          if (isInProgress(stored.phase)) {
            stored.phase = "error";
            stored.pct = 100;
            stored.error = stored.error || "Interrupted by worker restart";
            closeOpenGroups(stored.log, "error");
            appendLog(stored.log, { kind: "error", text: stored.error }, false);
            await appendHistory(stored).catch(() => {});
            orphaned = true;
          }
        }
        // The old worker's pipeline may still be running; stop it before this worker starts one.
        if (orphaned && !current) await browser.offscreen.closeDocument().catch(() => {});
        mirrorSession();
      } catch {}
    })();
  },
});
