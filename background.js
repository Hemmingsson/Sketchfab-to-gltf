/**
 * MV3 service worker: background job registry for Sketchfab downloads.
 *
 * Owns the job lifecycle:
 *   UI → enqueueDownload/retry → queue → offscreen "run" → progress/done/error
 *   → chrome.downloads save → history.
 *
 * Runs ONE job at a time: a 4K texture pack fills the offscreen heap, and two
 * concurrent pipelines would OOM it. Active jobs live in a Map (mirrored to
 * storage.session so a restarted SW or a freshly opened popup can read them);
 * finished jobs are appended to storage.local history.
 */

// Flip to false to silence the diagnostic logging. Logs land in the service
// worker console (chrome://extensions → this extension → "service worker").
const DEBUG = true;
function log(...a) {
  if (DEBUG) {
    try {
      console.log("[sf-dl/bg]", ...a);
    } catch (_) {}
  }
}

const UID_RE = /([a-f0-9]{32})/i;
const HISTORY_KEY = "sf_history";
const HISTORY_CAP = 50;
const SESSION_KEY = "sf_active";
const KEEPALIVE_MS = 20000;

/** uid → JobRecord. The single source of truth for in-flight work. */
const jobs = new Map();
/** uid → tabId that started the job, so we can push updates to its content
 * script. runtime.sendMessage broadcasts reach the popup but NOT content
 * scripts, so the injected button needs a tab-targeted message. */
const jobTabs = new Map();
/** uids waiting to run, FIFO. The head runs when nothing is in flight. */
const queue = [];
let running = false;
let keepTimer = null;

/** 32-hex model id from a Sketchfab URL, or null if none is present. */
function uidFromUrl(url) {
  const m = UID_RE.exec(String(url || ""));
  return m ? m[1].toLowerCase() : null;
}

/** Fire-and-forget broadcast to every listening UI. "No receiver" is normal. */
function broadcast(msg) {
  try {
    chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError);
  } catch (_) {}
}

function broadcastJob(job) {
  const tabId = jobTabs.get(job.uid);
  log("broadcastJob", job.uid, "phase=", job.phase, "pct=", job.pct, "→ tab", tabId);
  // Extension pages (popup).
  broadcast({ type: "jobUpdate", job });
  // The content-script button in the tab that started this job.
  if (typeof tabId === "number") {
    try {
      chrome.tabs.sendMessage(tabId, { type: "jobUpdate", job }, () => {
        const err = chrome.runtime.lastError;
        if (err) log("tabs.sendMessage to", tabId, "failed:", err.message);
      });
    } catch (e) {
      log("tabs.sendMessage threw:", e && e.message);
    }
  }
}

/** Mirror active jobs to session storage so a cold popup/SW can rehydrate. */
function mirrorSession() {
  try {
    const list = Array.from(jobs.values());
    chrome.storage.session.set({ [SESSION_KEY]: list }).catch(() => {});
  } catch (_) {}
}

function startKeepAlive() {
  if (keepTimer) return;
  keepTimer = setInterval(() => {
    try {
      chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError);
    } catch (_) {}
  }, KEEPALIVE_MS);
}

function stopKeepAlive() {
  if (keepTimer) {
    clearInterval(keepTimer);
    keepTimer = null;
  }
}

async function readHistory() {
  try {
    const data = await chrome.storage.local.get(HISTORY_KEY);
    const list = data && data[HISTORY_KEY];
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

/** Prepend a finished job to history, newest first, capped. Keeps `url`. */
async function appendHistory(job) {
  const history = await readHistory();
  const next = [job, ...history.filter((h) => h && h.id !== job.id)].slice(
    0,
    HISTORY_CAP
  );
  try {
    await chrome.storage.local.set({ [HISTORY_KEY]: next });
  } catch (_) {}
}

/**
 * Single offscreen document, created on demand. Reuses an existing one so we
 * never trip the "only a single offscreen document" limit.
 */
async function ensureOffscreen() {
  if (chrome.runtime.getContexts) {
    const existing = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
    if (existing && existing.length) return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen/offscreen.html",
      reasons: ["BLOBS", "WORKERS"],
      justification:
        "Decrypt model binaries and descramble textures off the service worker heap (4K packs OOM the SW).",
    });
  } catch (e) {
    const m = e && e.message ? e.message : String(e);
    // A concurrent create can race us; treat "already exists" as success.
    if (/already exists|duplicate|single offscreen/i.test(m)) return;
    throw e;
  }
}

/** Enqueue a fresh job for `uid`, unless it is already active. Returns the id. */
function enqueue(uid, url, name) {
  const active = jobs.get(uid);
  // Ignore re-enqueue of an in-flight uid; a finished uid restarts fresh.
  if (active && active.phase !== "done" && active.phase !== "error") {
    log("enqueue: uid", uid, "already active (", active.phase, ") — ignoring");
    return uid;
  }
  log("enqueue: new job", uid, "name=", name);
  const job = {
    id: uid,
    uid,
    url,
    name: (name && String(name).trim()) || "Sketchfab model",
    phase: "queued",
    pct: 0,
    log: [],
    filename: "",
    bytes: 0,
    error: "",
    startedAt: Date.now(),
    finishedAt: 0,
  };
  jobs.set(uid, job);
  if (!queue.includes(uid)) queue.push(uid);
  mirrorSession();
  broadcastJob(job);
  startKeepAlive();
  runNext();
  return uid;
}

/** Start the head of the queue if nothing is currently running. */
async function runNext() {
  if (running) return;
  const uid = queue.shift();
  if (!uid) {
    stopKeepAlive();
    return;
  }
  const job = jobs.get(uid);
  if (!job) {
    runNext();
    return;
  }
  running = true;
  startKeepAlive();
  try {
    log("runNext: ensuring offscreen for", uid);
    await ensureOffscreen();
    log("runNext: sending 'run' to offscreen for", uid);
    await chrome.runtime.sendMessage({
      target: "offscreen",
      action: "run",
      id: uid,
      url: job.url,
    });
  } catch (e) {
    log("runNext: failed to start", uid, e && e.message);
    failJob(job, e && e.message ? e.message : String(e));
  }
}

/** Mark a job failed, persist it, and move on. */
function failJob(job, message) {
  job.phase = "error";
  job.error = String(message || "Download failed");
  job.finishedAt = Date.now();
  jobs.delete(job.uid);
  mirrorSession();
  broadcastJob(job);
  jobTabs.delete(job.uid);
  appendHistory(job);
  running = false;
  runNext();
}

/** Kick off the browser download once the offscreen page hands us a blob URL. */
function saveJob(job, blobUrl, filename, bytes) {
  job.phase = "saving";
  job.filename = filename || job.filename || "sketchfab-model.glb";
  if (typeof bytes === "number") job.bytes = bytes;
  mirrorSession();
  broadcastJob(job);

  chrome.downloads.download(
    { url: blobUrl, filename: job.filename, saveAs: false },
    (downloadId) => {
      const err = chrome.runtime.lastError;
      if (err || downloadId === undefined || downloadId === null) {
        revokeOffscreen(job.uid);
        failJob(job, (err && err.message) || "Download did not start");
      }
      // Otherwise wait for downloads.onChanged (state complete/interrupted).
    }
  );
}

function revokeOffscreen(id) {
  broadcast({ target: "offscreen", action: "revoke", id });
}

/** Finish a job in the "saving" phase from a downloads.onChanged event. */
async function finishSave(job, state, bytes) {
  const ok = state === "complete";
  job.phase = ok ? "done" : "error";
  job.pct = ok ? 100 : job.pct;
  if (!ok) job.error = job.error || "Download interrupted";
  if (typeof bytes === "number" && bytes > 0) job.bytes = bytes;
  job.finishedAt = Date.now();
  jobs.delete(job.uid);
  mirrorSession();
  broadcastJob(job);
  jobTabs.delete(job.uid);
  await appendHistory(job);
  revokeOffscreen(job.uid);
  running = false;
  runNext();
}

/** Locate the active job currently in "saving" phase for a download event. */
function findSavingJob() {
  for (const job of jobs.values()) {
    if (job.phase === "saving") return job;
  }
  return null;
}

/* ---- offscreen → background pipeline messages ---- */

function handleOffscreen(msg) {
  const job = jobs.get(msg.id);
  if (!job) {
    log("offscreen msg for UNKNOWN job", msg.id, "kind=", msg.kind, "(dropped)");
    return;
  }

  if (msg.kind === "progress") {
    log("offscreen progress", msg.id, "pct=", msg.pct, "phase=", msg.phase, "text=", msg.text);
    if (typeof msg.pct === "number") job.pct = msg.pct;
    if (msg.phase) job.phase = msg.phase;
    if (msg.text) {
      const text = String(msg.text);
      job.log.push(text);
      // Authoritative name from the pipeline: "Model: <name> (by <author>)"
      // (author optional). Confirms/corrects the page-provided name.
      const mm = /^Model:\s*(.+?)(?:\s*\(by\b[^)]*\))?\s*$/i.exec(text);
      if (mm && mm[1]) job.name = mm[1].trim();
    }
    mirrorSession();
    broadcastJob(job);
    return;
  }

  if (msg.kind === "done") {
    log("offscreen done", msg.id, "filename=", msg.filename, "bytes=", msg.bytes);
    saveJob(job, msg.blobUrl, msg.filename, msg.bytes);
    return;
  }

  if (msg.kind === "error") {
    log("offscreen error", msg.id, msg.error);
    failJob(job, msg.error);
    return;
  }
}

/* ---- chrome.downloads lifecycle ---- */

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta || !delta.state) return;
  const state = delta.state.current;
  if (state !== "complete" && state !== "interrupted") return;
  const job = findSavingJob();
  if (!job) return;
  if (typeof chrome.downloads.search === "function") {
    chrome.downloads.search({ id: delta.id }, (items) => {
      const bytes = items && items[0] ? items[0].fileSize || items[0].totalBytes : 0;
      finishSave(job, state, bytes);
    });
  } else {
    finishSave(job, state, 0);
  }
});

/* ---- UI ↔ background messages ---- */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return false;

  // Offscreen pipeline events (no `action`, tagged by source).
  if (msg.source === "sf-offscreen") {
    handleOffscreen(msg);
    return false;
  }

  if (msg.action === "enqueueDownload" || msg.action === "retry") {
    const uid = uidFromUrl(msg.url);
    if (!uid) {
      sendResponse({ ok: false, error: "Could not parse a model id from the URL" });
      return false;
    }
    const tabId = _sender && _sender.tab ? _sender.tab.id : undefined;
    log(msg.action, "url=", msg.url, "uid=", uid, "name=", msg.name, "tab=", tabId);
    if (typeof tabId === "number") jobTabs.set(uid, tabId);
    const id = enqueue(uid, msg.url, msg.name);
    sendResponse({ ok: true, id });
    return false;
  }

  if (msg.action === "getJobs") {
    log("getJobs → active:", jobs.size);
    readHistory().then((history) => {
      const active = Array.from(jobs.values());
      const seen = new Set(active.map((j) => j.id));
      const past = history.filter((h) => h && !seen.has(h.id));
      sendResponse({ ok: true, jobs: [...active, ...past] });
    });
    return true; // async response
  }

  return false;
});

/* ---- Rehydrate active jobs after a SW restart (best-effort) ---- */

(async function rehydrate() {
  try {
    const data = await chrome.storage.session.get(SESSION_KEY);
    const list = data && data[SESSION_KEY];
    if (!Array.isArray(list)) return;
    for (const job of list) {
      if (!job || !job.uid) continue;
      // A job that was mid-flight when the SW died cannot be resumed; surface
      // it as an error so the UI stops showing a stuck spinner.
      if (job.phase !== "done" && job.phase !== "error") {
        job.phase = "error";
        job.error = job.error || "Interrupted by worker restart";
        job.finishedAt = job.finishedAt || Date.now();
        await appendHistory(job);
      }
    }
    await chrome.storage.session.remove(SESSION_KEY);
  } catch (_) {}
})();
