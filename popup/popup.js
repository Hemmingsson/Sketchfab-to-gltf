const listEl = document.getElementById("list");

// id -> { details, name, progress, pctText, lastLog, stats, pre }
const rows = new Map();

function clampPct(job) {
  if (job.phase === "done") return 100;
  const n = Number(job.pct);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function pctLabel(job, pct) {
  if (job.phase === "error") return "error";
  if (job.phase === "done") return "100%";
  return pct + "%";
}

function lastLogLine(job) {
  if (Array.isArray(job.log) && job.log.length > 0) {
    const line = job.log[job.log.length - 1];
    return line == null ? "" : String(line);
  }
  return "";
}

function fullLog(job) {
  return Array.isArray(job.log) ? job.log.join("\n") : "";
}

function formatCount(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "0";
  if (num >= 1000) return (num / 1000).toFixed(1) + "k";
  return String(num);
}

function statsText(job) {
  const v = Number(job.vertices) || 0;
  const t = Number(job.triangles) || 0;
  if (v > 0 || t > 0) {
    return "Triangles: " + formatCount(t) + " Vertices: " + formatCount(v);
  }
  return "";
}

function autoScroll(pre) {
  pre.scrollTop = pre.scrollHeight;
}

function createRow(job) {
  const pct = clampPct(job);

  const details = document.createElement("details");

  // Summary: three stacked lines.
  const summary = document.createElement("summary");

  const name = document.createElement("div");
  name.textContent = job.name || "Sketchfab model";

  const progressLine = document.createElement("div");
  const progress = document.createElement("progress");
  progress.value = pct;
  progress.max = 100;
  const pctText = document.createElement("span");
  pctText.textContent = " " + pctLabel(job, pct);
  progressLine.appendChild(progress);
  progressLine.appendChild(pctText);

  const lastLog = document.createElement("div");
  lastLog.textContent = lastLogLine(job);

  summary.appendChild(name);
  summary.appendChild(progressLine);
  summary.appendChild(lastLog);

  // Body.
  const link = document.createElement("a");
  link.href = job.url || "#";
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "Open on Sketchfab";

  const retry = document.createElement("button");
  retry.textContent = "Retry";
  retry.dataset.url = job.url || "";
  retry.addEventListener("click", () => retryJob(retry.dataset.url));

  const stats = document.createElement("div");
  stats.textContent = statsText(job);

  const pre = document.createElement("pre");
  pre.textContent = fullLog(job);

  details.appendChild(summary);
  details.appendChild(link);
  details.appendChild(document.createTextNode(" "));
  details.appendChild(retry);
  details.appendChild(stats);
  details.appendChild(pre);

  autoScroll(pre);

  rows.set(job.id, { details, name, progress, pctText, lastLog, stats, pre });
  return details;
}

function updateRow(entry, job) {
  const pct = clampPct(job);
  entry.name.textContent = job.name || "Sketchfab model";
  entry.progress.value = pct;
  entry.pctText.textContent = " " + pctLabel(job, pct);
  entry.lastLog.textContent = lastLogLine(job);
  entry.stats.textContent = statsText(job);
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
