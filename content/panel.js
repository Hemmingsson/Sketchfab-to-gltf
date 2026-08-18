/**
 * Content script (isolated world): the single injected download button.
 *
 * One reconciler, `syncToPage()`, is the whole model: on load and on every SPA
 * navigation it (1) removes the button off model pages, (2) resets the button
 * to idle so a previous model's state never bleeds onto a new page, then
 * (3) asks the background for the current model's job and renders it. Live
 * progress is pushed from the background to this tab and rendered the same way.
 */
(function () {
  const UID_RE =
    /sketchfab\.com\/(?:3d-models\/[^/?#]+-|models\/)([a-f0-9]{32})/i;
  const BTN_ID = "sf-dl-btn";
  const IN_PROGRESS = new Set([
    "queued",
    "reading",
    "decrypting",
    "textures",
    "packing",
    "converting",
    "zipping",
    "saving",
  ]);

  const DEBUG = true;
  function log(...a) {
    if (DEBUG) {
      try {
        console.log("[sf-dl/button]", ...a);
      } catch (_) {}
    }
  }

  function currentUid() {
    const m = String(location.href).match(UID_RE);
    return m ? m[1].toLowerCase() : null;
  }

  /** The model's display name, straight from the page the user is looking at. */
  function modelName() {
    try {
      const og = document.querySelector('meta[property="og:title"]');
      if (og && og.content) return og.content.trim();
    } catch (_) {}
    try {
      // "Name - Download Free 3D model by X - Sketchfab" → "Name"
      const cut = String(document.title || "").split(/\s+[-–—]\s+/)[0];
      if (cut) return cut.trim();
    } catch (_) {}
    return "";
  }

  function getButton() {
    return document.getElementById(BTN_ID);
  }

  /** Render the button purely from a state object ({phase, pct, error}). */
  function render(state) {
    const btn = getButton();
    if (!btn) return;
    const phase = (state && state.phase) || "idle";
    btn.dataset.phase = phase;
    if (phase === "done") {
      btn.className = "done";
      btn.textContent = "✓";
      btn.removeAttribute("title");
    } else if (phase === "error") {
      btn.className = "error";
      btn.textContent = "!";
      btn.title = (state && state.error) || "Download failed";
    } else if (IN_PROGRESS.has(phase)) {
      btn.className = "progress";
      btn.textContent = Math.max(0, Math.min(100, (state.pct | 0))) + "%";
      btn.removeAttribute("title");
    } else {
      btn.className = "";
      btn.textContent = "⬇";
      btn.removeAttribute("title");
    }
  }

  function onClick() {
    const uid = currentUid();
    if (!uid) return;
    const name = modelName();
    log("click → enqueue", uid, "name=", name);
    render({ phase: "queued", pct: 0 });
    try {
      chrome.runtime.sendMessage({
        action: "enqueueDownload",
        url: location.href,
        name,
      });
    } catch (e) {
      log("enqueue send failed", e && e.message);
    }
  }

  // On a finished (green ✓) button, hovering reveals the ⬇ icon again — a
  // click re-downloads.
  function onHover() {
    const btn = getButton();
    if (btn && btn.dataset.phase === "done") {
      btn.className = "";
      btn.textContent = "⬇";
    }
  }
  function onUnhover() {
    const btn = getButton();
    if (btn && btn.dataset.phase === "done") {
      btn.className = "done";
      btn.textContent = "✓";
    }
  }

  function ensureButton() {
    let btn = getButton();
    if (btn) return btn;
    btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.addEventListener("click", onClick);
    btn.addEventListener("mouseenter", onHover);
    btn.addEventListener("mouseleave", onUnhover);
    document.documentElement.appendChild(btn);
    log("button injected");
    return btn;
  }

  function removeButton() {
    const btn = getButton();
    if (btn) {
      btn.remove();
      log("button removed");
    }
  }

  /** Reconcile the button with the current page. Reset first, then restore. */
  function syncToPage() {
    const uid = currentUid();
    if (!uid) {
      removeButton();
      return;
    }
    ensureButton();
    render({ phase: "idle" }); // no stale ✓ from a previously-downloaded model
    log("sync uid=", uid, "→ getJobs");
    let res;
    try {
      res = chrome.runtime.sendMessage({ action: "getJobs" });
    } catch (e) {
      log("getJobs send failed", e && e.message);
      return;
    }
    if (!res || typeof res.then !== "function") {
      log("getJobs: no promise returned");
      return;
    }
    res
      .then((reply) => {
        if (currentUid() !== uid) return; // navigated again meanwhile
        const job = (reply && reply.jobs ? reply.jobs : []).find(
          (j) => j && j.uid === uid
        );
        log("getJobs reply: job for", uid, "?", !!job, job && job.phase);
        render(job || { phase: "idle" });
      })
      .catch((e) => log("getJobs rejected", e && e.message));
  }

  // Live updates pushed from the background to this tab.
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== "jobUpdate" || !msg.job) return;
      const uid = currentUid();
      log("jobUpdate", msg.job.uid, msg.job.phase, msg.job.pct + "%", "(current", uid + ")");
      if (msg.job.uid !== uid) return;
      render(msg.job);
    });
  } catch (e) {
    log("onMessage listener failed", e && e.message);
  }

  syncToPage();

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      log("navigation →", location.href);
      syncToPage();
    }
  }, 500);
})();
