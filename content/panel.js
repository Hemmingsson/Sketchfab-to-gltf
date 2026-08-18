/**
 * Content script (isolated world): a single injected download button.
 * - Detects Sketchfab model pages and injects one corner button.
 * - Click enqueues a background download; the button reflects job state.
 * - Follows SPA URL changes and restores state from the background registry.
 */
(function () {
  const UID_RE =
    /sketchfab\.com\/(?:3d-models\/[^/?#]+-|models\/)([a-f0-9]{32})/i;
  const BTN_ID = "sf-dl-btn";
  const PROGRESS_PHASES = [
    "queued",
    "reading",
    "decrypting",
    "textures",
    "packing",
    "converting",
    "zipping",
    "saving",
  ];

  function currentUid() {
    const m = String(location.href).match(UID_RE);
    return m ? m[1].toLowerCase() : null;
  }

  function sendMessage(msg) {
    try {
      return chrome.runtime.sendMessage(msg);
    } catch (_) {
      return undefined;
    }
  }

  function getButton() {
    return document.getElementById(BTN_ID);
  }

  function setIdle(btn) {
    btn.className = "";
    btn.textContent = "⬇"; // ⬇
    btn.removeAttribute("title");
  }

  function applyJob(btn, job) {
    if (!btn || !job) return;
    const phase = job.phase;
    if (phase === "done") {
      btn.className = "done";
      btn.textContent = "✓"; // ✓
      btn.removeAttribute("title");
    } else if (phase === "error") {
      btn.className = "error";
      btn.textContent = "!";
      btn.title = job.error || "Download failed";
    } else if (PROGRESS_PHASES.indexOf(phase) !== -1) {
      btn.className = "progress";
      const pct = Math.max(0, Math.min(100, job.pct | 0));
      btn.textContent = pct + "%";
      btn.removeAttribute("title");
    }
  }

  // The background pushes jobUpdate via chrome.runtime.sendMessage, which
  // reaches extension pages (the popup) but NOT content scripts. So the button
  // polls getJobs while its job is in flight. (The onMessage listener below is
  // kept as a harmless fast-path in case updates are ever also tab-messaged.)
  let pollTimer = null;
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }
  function pollOnce() {
    const uid = currentUid();
    const btn = getButton();
    if (!uid || !btn) {
      stopPolling();
      return;
    }
    const res = sendMessage({ action: "getJobs" });
    if (!res || typeof res.then !== "function") return;
    res
      .then((reply) => {
        const b = getButton();
        if (!b || currentUid() !== uid) return;
        const job = (reply && reply.jobs ? reply.jobs : []).find(
          (j) => j && j.uid === uid
        );
        if (!job) return;
        applyJob(b, job);
        if (job.phase === "done" || job.phase === "error") stopPolling();
      })
      .catch(() => {});
  }
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(pollOnce, 600);
  }

  function onClick() {
    const btn = getButton();
    if (!btn) return;
    btn.className = "progress";
    btn.textContent = "0%";
    btn.removeAttribute("title");
    sendMessage({ action: "enqueueDownload", url: location.href });
    startPolling();
  }

  function injectButton() {
    if (getButton()) return; // guard against double-injection
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    setIdle(btn);
    btn.addEventListener("click", onClick);
    document.documentElement.appendChild(btn);
    restoreState();
  }

  function removeButton() {
    stopPolling();
    const btn = getButton();
    if (btn) btn.remove();
  }

  function restoreState() {
    const uid = currentUid();
    if (!uid) return;
    let res;
    try {
      res = chrome.runtime.sendMessage({ action: "getJobs" });
    } catch (_) {
      return;
    }
    if (!res || typeof res.then !== "function") return;
    res
      .then((reply) => {
        const btn = getButton();
        if (!btn || currentUid() !== uid) return;
        const jobs = reply && reply.jobs ? reply.jobs : [];
        const job = jobs.find((j) => j && j.uid === uid);
        if (job) {
          applyJob(btn, job);
          if (job.phase !== "done" && job.phase !== "error") startPolling();
        } else {
          setIdle(btn);
        }
      })
      .catch(() => {});
  }

  function sync() {
    if (currentUid()) injectButton();
    else removeButton();
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== "jobUpdate" || !msg.job) return;
      if (msg.job.uid !== currentUid()) return;
      const btn = getButton();
      if (btn) applyJob(btn, msg.job);
    });
  } catch (_) {}

  sync();

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      sync();
    }
  }, 800);
})();
