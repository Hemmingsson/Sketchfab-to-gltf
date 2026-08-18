/**
 * Content script (isolated world): a single injected download button.
 * - Detects Sketchfab model pages and injects one corner button.
 * - Click enqueues a background download; the button reflects live job state
 *   (pushed from the background via chrome.tabs.sendMessage to this tab).
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
    btn.dataset.phase = "idle";
    btn.className = "";
    btn.textContent = "⬇";
    btn.removeAttribute("title");
  }

  function applyJob(btn, job) {
    if (!btn || !job) return;
    const phase = job.phase;
    btn.dataset.phase = phase;
    if (phase === "done") {
      // Hover reveals the download icon again (a click re-downloads).
      btn.className = "done";
      btn.textContent = "✓";
      btn.removeAttribute("title");
    } else if (phase === "error") {
      btn.className = "error";
      btn.textContent = "!";
      btn.title = job.error || "Download failed";
    } else if (PROGRESS_PHASES.indexOf(phase) !== -1) {
      btn.className = "progress";
      btn.textContent = Math.max(0, Math.min(100, job.pct | 0)) + "%";
      btn.removeAttribute("title");
    }
  }

  function onClick() {
    const btn = getButton();
    if (!btn) return;
    btn.dataset.phase = "progress";
    btn.className = "progress";
    btn.textContent = "0%";
    btn.removeAttribute("title");
    sendMessage({ action: "enqueueDownload", url: location.href });
  }

  function injectButton() {
    if (getButton()) return; // guard against double-injection
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    setIdle(btn);
    btn.addEventListener("click", onClick);
    // On a finished button, hovering shows the download icon (re-download).
    btn.addEventListener("mouseenter", () => {
      if (btn.dataset.phase === "done") {
        btn.className = "";
        btn.textContent = "⬇";
      }
    });
    btn.addEventListener("mouseleave", () => {
      if (btn.dataset.phase === "done") {
        btn.className = "done";
        btn.textContent = "✓";
      }
    });
    document.documentElement.appendChild(btn);
    restoreState();
  }

  function removeButton() {
    const btn = getButton();
    if (btn) btn.remove();
  }

  function restoreState() {
    const uid = currentUid();
    if (!uid) return;
    const res = sendMessage({ action: "getJobs" });
    if (!res || typeof res.then !== "function") return;
    res
      .then((reply) => {
        const btn = getButton();
        if (!btn || currentUid() !== uid) return;
        const job = (reply && reply.jobs ? reply.jobs : []).find(
          (j) => j && j.uid === uid
        );
        if (job) applyJob(btn, job);
        else setIdle(btn);
      })
      .catch(() => {});
  }

  function sync() {
    if (currentUid()) injectButton();
    else removeButton();
  }

  // Live updates pushed from the background to this tab.
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
