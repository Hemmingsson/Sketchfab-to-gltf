const listEl = document.getElementById("list");

// id -> { details, progress, pctText, pre, summaryName }
const rows = new Map();

function clampPct(job) {
  if (job.phase === "done") return 100;
  const n = Number(job.pct);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function pctLabel(job, pct) {
  if (job.phase === "error") return job.error ? String(job.error) : "error";
  if (job.phase === "done") return "100%";
  return pct + "%";
}

function createRow(job) {
  const pct = clampPct(job);

  const details = document.createElement("details");

  const summary = document.createElement("summary");
  const summaryName = document.createElement("span");
  summaryName.textContent = job.name || "Sketchfab model";
  const progress = document.createElement("progress");
  progress.value = pct;
  progress.max = 100;
  const pctText = document.createElement("span");
  pctText.textContent = " " + pctLabel(job, pct);
  summary.appendChild(summaryName);
  summary.appendChild(document.createTextNode(" "));
  summary.appendChild(progress);
  summary.appendChild(pctText);

  const link = document.createElement("a");
  link.href = job.url || "#";
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "Open on Sketchfab";

  const retry = document.createElement("button");
  retry.textContent = "Retry";
  retry.dataset.url = job.url || "";
  retry.addEventListener("click", () => retryJob(retry.dataset.url));

  const pre = document.createElement("pre");
  pre.textContent = Array.isArray(job.log) ? job.log.join("\n") : "";

  details.appendChild(summary);
  details.appendChild(link);
  details.appendChild(document.createTextNode(" "));
  details.appendChild(retry);
  details.appendChild(pre);

  rows.set(job.id, { details, progress, pctText, pre, summaryName });
  return details;
}

function updateRow(entry, job) {
  const pct = clampPct(job);
  entry.summaryName.textContent = job.name || "Sketchfab model";
  entry.progress.value = pct;
  entry.pctText.textContent = " " + pctLabel(job, pct);
  entry.pre.textContent = Array.isArray(job.log) ? job.log.join("\n") : "";
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
