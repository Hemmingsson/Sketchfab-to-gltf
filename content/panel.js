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

  function currentUid() {
    const m = String(location.href).match(UID_RE);
    return m ? m[1].toLowerCase() : null;
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
    render({ phase: "queued", pct: 0 });
    try {
      const p = chrome.runtime.sendMessage({ action: "enqueueDownload", url: location.href });
      if (p && typeof p.then === "function") {
        p.catch(() => {});
      }
    } catch (_) {}
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
    document.body.appendChild(btn);
    return btn;
  }

  function removeButton() {
    const btn = getButton();
    if (btn) {
      btn.remove();
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
    let res;
    try {
      res = chrome.runtime.sendMessage({ action: "getJobs" });
    } catch (_) {
      return;
    }
    if (!res || typeof res.then !== "function") {
      return;
    }
    res
      .then((reply) => {
        if (currentUid() !== uid) return; // navigated again meanwhile
        const job = (reply && reply.jobs ? reply.jobs : []).find(
          (j) => j && j.uid === uid
        );
        render(job || { phase: "idle" });
      })
      .catch(() => {});
  }

  // Live updates pushed from the background to this tab.
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== "jobUpdate" || !msg.job) return;
      const uid = currentUid();
      if (msg.job.uid !== uid) return;
      render(msg.job);
    });
  } catch (_) {}

  // Sketchfab is a SPA. Re-sync whenever the URL changes — via the Navigation
  // API (or a poll fallback when it's unavailable) plus popstate.
  let lastHref = location.href;
  function onNav(reason) {
    if (location.href === lastHref) return;
    lastHref = location.href;
    syncToPage();
  }

  syncToPage();

  try {
    window.addEventListener("popstate", () => onNav("popstate"));
  } catch (_) {}
  // Prefer the Navigation API when available; otherwise fall back to polling.
  if (window.navigation && window.navigation.addEventListener) {
    // Use "navigatesuccess" (fires AFTER the navigation commits, with
    // location.href already updated) rather than "navigate" (fires before the
    // commit, when location.href is still the old URL and onNav's guard skips).
    window.navigation.addEventListener("navigatesuccess", () => onNav("navigation"));
  } else {
    setInterval(() => onNav("poll"), 400);
  }
})();
