const appEl = document.getElementById("app");
const listEl = document.getElementById("list");

// Popups reset every open, so remember the resized box in localStorage and
// restore it. Chrome caps the window near 800x600, hence the CSS max-*.
const SIZE_KEY = "sf_popup_size";
try {
  const saved = JSON.parse(localStorage.getItem(SIZE_KEY) || "null");
  if (saved && saved.w) appEl.style.width = saved.w + "px";
  if (saved && saved.h) appEl.style.height = saved.h + "px";
} catch (_) {}
try {
  const ro = new ResizeObserver(() => {
    try {
      localStorage.setItem(
        SIZE_KEY,
        JSON.stringify({ w: Math.round(appEl.offsetWidth), h: Math.round(appEl.offsetHeight) })
      );
    } catch (_) {}
  });
  ro.observe(appEl);
} catch (_) {}

// id -> { details, name, progress, lastLog, pre }
const rows = new Map();

function clampPct(job) {
  if (job.phase === "done" || job.phase === "error") return 100;
  const n = Number(job.pct);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function progressClass(job) {
  if (job.error || job.phase === "error") return "error";
  if (job.phase === "done") return "done";
  return "";
}

function lastLogLine(job) {
  if (job.error) return String(job.error);
  if (Array.isArray(job.log) && job.log.length > 0) {
    const line = job.log[job.log.length - 1];
    return line == null ? "" : String(line);
  }
  return "";
}

function fullLog(job) {
  return Array.isArray(job.log) ? job.log.join("\n") : "";
}

function autoScroll(pre) {
  pre.scrollTop = pre.scrollHeight;
}

function createRow(job) {
  const pct = clampPct(job);

  const details = document.createElement("details");

  // Summary: name, a full-width progress bar (no percentage), latest log line.
  const summary = document.createElement("summary");

  const name = document.createElement("div");
  name.className = "name";
  name.textContent = job.name || "Sketchfab model";

  const progress = document.createElement("progress");
  progress.max = 100;
  progress.value = pct;
  progress.className = progressClass(job);

  const lastLog = document.createElement("div");
  lastLog.className = "log";
  lastLog.textContent = lastLogLine(job);

  summary.appendChild(name);
  summary.appendChild(progress);
  summary.appendChild(lastLog);

  // Body: SF-symbol style action glyphs (labels via title).
  const link = document.createElement("a");
  link.href = job.url || "#";
  link.target = "_blank";
  link.rel = "noreferrer";
  link.title = "Open on Sketchfab";
  link.textContent = "↗"; // ↗

  const retry = document.createElement("button");
  retry.title = "Retry";
  retry.textContent = "↻"; // ↻
  retry.dataset.url = job.url || "";
  retry.addEventListener("click", () => retryJob(retry.dataset.url));

  const pre = document.createElement("pre");
  pre.textContent = fullLog(job);

  details.appendChild(summary);
  details.appendChild(link);
  details.appendChild(document.createTextNode(" "));
  details.appendChild(retry);
  details.appendChild(pre);

  autoScroll(pre);

  rows.set(job.id, { details, name, progress, lastLog, pre });
  return details;
}

function updateRow(entry, job) {
  const pct = clampPct(job);
  entry.name.textContent = job.name || "Sketchfab model";
  entry.progress.value = pct;
  entry.progress.className = progressClass(job);
  entry.lastLog.textContent = lastLogLine(job);
  entry.pre.textContent = fullLog(job);
  autoScroll(entry.pre);
}

function upsertJob(job, { prepend } = {}) {
  if (!job || job.id == null) return;
  const existing = rows.get(job.id);
  if (existing) {
    updateRow(existing, job);
    return;
  }
  const details = createRow(job);
  if (prepend && listEl.firstChild) {
    listEl.insertBefore(details, listEl.firstChild);
  } else {
    listEl.appendChild(details);
  }
}

function retryJob(url) {
  if (!url) return;
  try {
    chrome.runtime.sendMessage({ action: "retry", url });
  } catch (_) {}
}

async function loadJobs() {
  try {
    const res = await chrome.runtime.sendMessage({ action: "getJobs" });
    const jobs = res && Array.isArray(res.jobs) ? res.jobs : [];
    for (const job of jobs) upsertJob(job);
  } catch (_) {}
}

try {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "jobUpdate" && msg.job) {
      upsertJob(msg.job, { prepend: true });
    }
  });
} catch (_) {}

loadJobs();
