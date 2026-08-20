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

// --- Smooth progress ---------------------------------------------------------
// The offscreen reports a coarse pipeline PHASE; we animate the percentage
// smoothly toward that phase's ceiling on a timer so the bar always glides
// (no per-texture jumps, no long stalls). One source of truth for both UIs.
const PHASE_CEIL = {
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
let smoothTimer = null;

function startSmoother() {
  if (smoothTimer) return;
  smoothTimer = setInterval(() => {
    if (jobs.size === 0) {
      stopSmoother();
      return;
    }
    for (const job of jobs.values()) {
      if (job.phase === "done" || job.phase === "error") continue;
      const ceil = PHASE_CEIL[job.phase] ?? job.pct;
      if (job.pct < ceil - 0.5) {
        // Ease toward the ceiling, but always creep at least a little so a
        // long silent phase (key reads, ORM packing) never looks frozen.
        job.pct = Math.min(ceil - 0.5, job.pct + Math.max(0.4, (ceil - job.pct) * 0.06));
        broadcastJob(job);
      }
    }
  }, SMOOTH_MS);
}
function stopSmoother() {
  if (smoothTimer) {
    clearInterval(smoothTimer);
    smoothTimer = null;
  }
}

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
  // Extension pages (popup).
  broadcast({ type: "jobUpdate", job });
  // The content-script button in the tab that started this job. Fire-and-forget
  // (the content script doesn't reply, so we don't pass a response callback —
  // that avoids the noisy "message port closed" warnings).
  if (typeof tabId === "number") {
    try {
      const p = chrome.tabs.sendMessage(tabId, { type: "jobUpdate", job });
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (_) {}
  }
  updateBadge();
}

/**
 * Toolbar progress badge. Shows the furthest-along active job's whole-number
 * percent while work is in flight; cleared the moment the queue drains (via
 * this function when jobs is empty, and directly in runNext). Before any job reports progress
 * (all still queued at pct 0) we show the active-job COUNT rather than a
 * misleading "0".
 */
function updateBadge() {
  try {
    if (jobs.size === 0) {
      clearBadge();
      return;
    }
    let pct = 0;
    for (const job of jobs.values()) {
      if (job.pct > pct) pct = job.pct;
    }
    const rounded = Math.round(pct);
    chrome.action.setBadgeText({
      text: rounded > 0 ? String(rounded) : String(jobs.size),
    });
  } catch (_) {}
}

function clearBadge() {
  try {
    chrome.action.setBadgeText({ text: "" });
  } catch (_) {}
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
      reasons: ["BLOBS"],
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
function enqueue(uid, url) {
  const active = jobs.get(uid);
  // Ignore re-enqueue of an in-flight uid; a finished uid restarts fresh.
  if (active && active.phase !== "done" && active.phase !== "error") {
    return uid;
  }
  const job = {
    id: uid,
    uid,
    url,
    name: "Sketchfab model", // corrected from the pipeline "Model:" line
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
    clearBadge();
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
    await ensureOffscreen();
    await chrome.runtime.sendMessage({
      target: "offscreen",
      action: "run",
      id: uid,
      url: job.url,
    });
  } catch (e) {
    console.error("[sf-dl] failed to start job", uid, e && e.message);
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
  job.filename = filename || job.filename || "3d_model.glb";
  if (typeof bytes === "number") job.bytes = bytes;
  mirrorSession();
  broadcastJob(job);

  chrome.downloads.download(
    { url: blobUrl, filename: job.filename, saveAs: false },
    (downloadId) => {
      const err = chrome.runtime.lastError;
      if (err || downloadId === undefined || downloadId === null) {
        // Primary blob path failed to start — try the data-URL fallback once.
        tryDataUrlFallback(job, (err && err.message) || "Download did not start");
      }
      // Otherwise wait for downloads.onChanged (state complete/interrupted).
    }
  );
}

/**
 * Data-URL fallback for a save that the blob path could not land. Some
 * environments reject or interrupt blob: downloads from a service worker; a
 * self-contained data: URL sidesteps that. We ask the offscreen page (which
 * holds the bytes) for a base64 STRING — it encodes there, since a raw
 * ArrayBuffer does not survive JSON-serialized runtime messaging — build the
 * data: URL from it, and retry the download exactly ONCE. Only if this retry
 * also fails do we fail the job.
 *
 * Memory cost: a data: URL materialises the whole file as a ~1.37x base64
 * string in the SW heap — acceptable only as a last-resort, single-shot retry.
 */
function tryDataUrlFallback(job, reason) {
  if (job._fallbackTried) {
    revokeOffscreen(job.uid);
    failJob(job, reason || "Download failed");
    return;
  }
  job._fallbackTried = true;
  let handled = false;
  const giveUp = (message) => {
    if (handled) return;
    handled = true;
    revokeOffscreen(job.uid);
    failJob(job, message || reason || "Download failed");
  };
  try {
    chrome.runtime.sendMessage(
      { target: "offscreen", action: "refetchBytes", id: job.uid },
      (resp) => {
        void chrome.runtime.lastError;
        if (handled) return;
        // Offscreen base64-encodes the bytes and returns a STRING (a raw
        // ArrayBuffer would arrive as {} over JSON-serialized messaging and
        // silently write a 0-byte file). Build the data URL directly from it.
        if (!resp || !resp.ok || !resp.base64) {
          giveUp(reason);
          return;
        }
        // Re-entrancy guard (M1): a duplicate "interrupted" event may have
        // already advanced the queue and started the next job. Only retry if
        // THIS job is still live and unfinished.
        if (!jobs.has(job.uid) || job.phase !== "saving") {
          giveUp(reason);
          return;
        }
        const dataUrl = `data:${resp.mime || "application/octet-stream"};base64,${resp.base64}`;
        chrome.downloads.download(
          { url: dataUrl, filename: job.filename, saveAs: false },
          (downloadId) => {
            const err = chrome.runtime.lastError;
            if (err || downloadId === undefined || downloadId === null) {
              giveUp((err && err.message) || reason);
            }
            // Success: wait for downloads.onChanged. _fallbackTried is set, so
            // a later "interrupted" fails the job instead of looping.
          }
        );
      }
    );
  } catch (e) {
    giveUp((e && e.message) || reason);
  }
}

function revokeOffscreen(id) {
  broadcast({ target: "offscreen", action: "revoke", id });
}

/** Finish a job in the "saving" phase from a downloads.onChanged event. */
async function finishSave(job, state, bytes) {
  const ok = state === "complete";
  // A pipeline-level error (e.g. animation lost) may already be attached while
  // the diagnostic zip is still saving. Keep the red phase after the file lands.
  if (job.error) {
    job.phase = "error";
  } else {
    job.phase = ok ? "done" : "error";
    if (!ok) job.error = job.error || "Download interrupted";
  }
  job.pct = ok || job.error ? 100 : job.pct;
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
    console.warn("[sf-dl] offscreen message for unknown job", msg.id, "kind=", msg.kind, "(dropped)");
    return;
  }

  if (msg.kind === "progress") {
    // The percentage is animated by the smoother toward this phase's ceiling.
    if (msg.phase) job.phase = msg.phase;
    if (msg.text) {
      const text = String(msg.text);
      job.log.push(text);
      // Authoritative model name from the pipeline: "Model: <name> (by <author>)"
      // (author optional).
      const mm = /^Model:\s*(.+?)(?:\s*\(by\b[^)]*\))?\s*$/i.exec(text);
      if (mm && mm[1]) job.name = mm[1].trim();
    }
    startSmoother();
    mirrorSession();
    broadcastJob(job); // immediate (phase/name/log); the smoother animates pct
    return;
  }

  if (msg.kind === "done") {
    saveJob(job, msg.blobUrl, msg.filename, msg.bytes);
    return;
  }

  if (msg.kind === "error") {
    console.error("[sf-dl] pipeline error", msg.id, msg.error);
    // done-then-error: the file is already being saved. Attach the message and
    // keep the job in the map so finishSave / findSavingJob still work.
    if (job.phase === "saving" || job.phase === "done") {
      job.error = String(msg.error || "Download failed");
      if (job.phase === "done") job.phase = "error";
      mirrorSession();
      broadcastJob(job);
      return;
    }
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
  if (state === "interrupted" && !job._fallbackTried) {
    // The blob download was interrupted — try the data-URL fallback once
    // before surfacing a hard error.
    tryDataUrlFallback(job, "Download interrupted");
    return;
  }
  chrome.downloads.search({ id: delta.id }, (items) => {
    const bytes = items && items[0] ? items[0].fileSize || items[0].totalBytes : 0;
    finishSave(job, state, bytes);
  });
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
    if (typeof tabId === "number") jobTabs.set(uid, tabId);
    const id = enqueue(uid, msg.url);
    sendResponse({ ok: true, id });
    return false;
  }

  if (msg.action === "getJobs") {
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
