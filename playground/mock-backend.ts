import { toast } from "svelte-sonner";
import { isMilestoneStage, stageMilestone } from "../src/lib/milestones.js";
import { modelUid } from "../src/lib/model-url.js";
import { createTextureLog, keyScanDone, keyScanProbe } from "../src/lib/log-groups.js";
import { appendLog, closeOpenGroups } from "../src/lib/progress.js";
import { exportFilename, sanitizeName } from "../src/lib/settings.js";
import { isInProgress } from "../src/shared/format";
import { clearPageToastsIfDisabled, toastForJob } from "../src/shared/job-toasts";
import { app, type Backend } from "../src/shared/store.svelte";
import type { DownloadJob, JobPhase, Settings } from "../src/shared/types";
import { DEMO_TEXTURES, SAMPLE_THUMB, emitLine } from "./seed";

let simTimer = 0;

function randomUid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function findJob(uid: string): DownloadJob | undefined {
  return app.jobs.find((j) => j.uid === uid);
}

function touch(job: DownloadJob) {
  job.updatedAt = Date.now();
}

type LogLine = Parameters<typeof appendLog>[1];

/** One simulated tick: optional phase/pct change, then log writes. */
type Step = {
  phase?: JobPhase;
  pct?: number;
  /** Delay before this step (ms). */
  ms?: number;
  run: (job: DownloadJob) => void;
};

const line =
  (l: LogLine, active = true) =>
  (job: DownloadJob) =>
    appendLog(job.log, l, active);

/** ~20 key probes, then the closed key row. */
function keyScanSteps(): Step[] {
  const scripts = Array.from({ length: 20 }, (_, i) => `viewer-${(i * 7919 + 4096).toString(16)}.js`);
  return [
    ...scripts.map((s) => ({
      phase: "decrypting" as JobPhase,
      pct: 14,
      ms: 90,
      run: (job: DownloadJob) => emitLine(job.log, ...keyScanProbe(s)),
    })),
    {
      pct: 18,
      run: (job) => emitLine(job.log, ...keyScanDone("71c5b342a9e0d6f1", scripts.length)),
    },
  ];
}

/**
 * Texture batch through the pipeline's own `createTextureLog`: texture i starts
 * at tick 2i and settles at tick 2i + 5, so 2–3 descrambles are in flight.
 * Index 4 has no pk (passthrough); index 9 warns during the descramble.
 */
function textureSteps(): Step[] {
  const textures = DEMO_TEXTURES;
  const N = textures.length;
  const PASSTHROUGH = 4;
  const WARN = 9;
  const events: { tick: number; i: number; kind: "start" | "work" | "end" }[] = [];
  textures.forEach((_, i) => {
    events.push({ tick: 2 * i, i, kind: "start" });
    events.push({ tick: 2 * i + 2, i, kind: "work" });
    events.push({ tick: 2 * i + 5, i, kind: "end" });
  });
  events.sort((a, b) => a.tick - b.tick || (a.kind === "end" ? -1 : 1));

  let target: DownloadJob | undefined;
  let texLog: ReturnType<typeof createTextureLog> | undefined;
  const rows = new Map<number, ReturnType<ReturnType<typeof createTextureLog>["start"]>>();

  const steps: Step[] = [
    {
      phase: "textures",
      pct: 28,
      run: (job) => {
        target = job;
        texLog = createTextureLog(N, (text, meta) => target && emitLine(target.log, text, meta));
      },
    },
  ];
  events.forEach((ev, n) => {
    const t = textures[ev.i];
    const [w, h] = t.size.split("x").map(Number);
    steps.push({
      pct: 28 + Math.round((n / events.length) * 34),
      ms: 260,
      run: (job) => {
        target = job;
        if (ev.kind === "start") {
          rows.set(ev.i, texLog!.start(t.name));
        } else if (ev.kind === "work") {
          const row = rows.get(ev.i)!;
          if (ev.i === PASSTHROUGH) return row.step("passthrough");
          row.progress("descramble start…");
          if (ev.i === WARN) row.step("descramble ok · checksum mismatch", "warn");
          else row.progress(`descramble ${w}x${h} pk=${(ev.i * 37) % 97}`);
        } else {
          const out = ev.i === PASSTHROUGH ? t.bytes : Math.round(t.bytes * 1.08);
          rows.get(ev.i)!.done({
            width: w,
            height: h,
            inBytes: t.bytes,
            outBytes: out,
            fromDescramble: ev.i !== PASSTHROUGH,
            pk: (ev.i * 37) % 97,
          });
        }
      },
    });
  });
  steps.push({ pct: 62, run: () => texLog!.finish() });
  steps.push({
    pct: 63,
    run: line({ kind: "detail", depth: 1, text: "NOTE: 1 texture(s) look unusually small (6500 B)" }),
  });
  return steps;
}

function startSimulation(uid: string) {
  window.clearTimeout(simTimer);

  const edge = app.settings.maxTextureEdge;
  const texCap =
    edge === 2048 || edge === 4096
      ? { kind: "detail" as const, depth: 1, text: `Texture size cap: ${edge}px` }
      : { kind: "detail" as const, depth: 1, text: "Texture size: original" };
  const sceneLine = app.settings.includeViewerScene
    ? { kind: "detail" as const, depth: 1, text: "Viewer camera: fov 45.0° · 3 lights" }
    : { kind: "detail" as const, depth: 1, text: "Viewer camera & lights: omitted (setting)" };
  const jobName = findJob(uid)?.name || "demo";
  const saveName = exportFilename({
    name: sanitizeName(jobName),
    uid,
    uidInFilename: app.settings.uidInFilename,
    exportFormat: app.settings.exportFormat,
    debugZip: app.settings.debugZip,
  });
  const demoBytes = 2_400_000 + Math.floor(Math.random() * 4_000_000);
  const demoMeshes = 12 + Math.floor(Math.random() * 40);
  const demoImages = 4 + Math.floor(Math.random() * 12);

  const steps: Step[] = [
    { phase: "reading", pct: 8, run: line({ kind: "reading", text: "Reading public viewer…" }) },
    { pct: 10, run: line({ kind: "detail", depth: 1, text: "Model: Demo (by Demo Author)" }) },
    { pct: 11, run: line(sceneLine) },
    ...keyScanSteps(),
    { pct: 20, run: line({ kind: "decrypt", text: "Decrypting file.binz…" }) },
    { pct: 22, run: line({ kind: "detail", depth: 1, text: "→ file.osgjs (1153433 bytes)" }) },
    { pct: 26, run: line(texCap) },
    ...textureSteps(),
    { phase: "packing", pct: 68, run: line({ kind: "pack", text: "Packing ORM maps…" }) },
    {
      pct: 72,
      run: line({ kind: "detail", depth: 1, text: "Packed 2 ORM map(s) from separate metal/rough maps" }),
    },
    {
      phase: "converting",
      pct: 82,
      run: line({ kind: "convert", text: "Converting osgjs → glTF (GLB)…" }),
    },
    {
      pct: 88,
      run: line({
        kind: "detail",
        depth: 1,
        text: `GLB ready (${demoBytes} bytes, ${demoMeshes} mesh(es), ${demoImages} image(s) embedded, 0 animation(s))`,
      }),
    },
    { phase: "saving", pct: 94, run: line({ kind: "save", text: `Saving ${saveName}…` }) },
  ];
  let i = 0;
  let stageStartedAt = Date.now();

  const first = findJob(uid);
  if (first) toastForJob(first);

  const tick = () => {
    const job = findJob(uid);
    if (!job) return;

    if (i < steps.length) {
      const step = steps[i++];
      if (step.phase && step.phase !== job.phase) {
        const now = Date.now();
        if (step.phase === "saving") job.bytes = demoBytes;
        const milestone = stageMilestone(job.phase, step.phase, {
          startedAt: stageStartedAt,
          now,
          bytes: step.phase === "saving" ? demoBytes : undefined,
        });
        if (milestone) appendLog(job.log, milestone);
        job.phase = step.phase;
        if (isMilestoneStage(step.phase)) stageStartedAt = now;
      } else if (step.phase) {
        job.phase = step.phase;
      }
      if (step.pct !== undefined) job.pct = step.pct;
      step.run(job);
      touch(job);
      toastForJob(job);
      simTimer = window.setTimeout(tick, steps[i]?.ms ?? 700);
      return;
    }

    job.phase = "done";
    job.pct = 100;
    job.bytes = demoBytes;
    job.meshCount = demoMeshes;
    job.imageCount = demoImages;
    job.filename = saveName;
    appendLog(job.log, { kind: "done", text: `Saved ${job.filename}` }, false);
    touch(job);
    toastForJob(job);
  };
  simTimer = window.setTimeout(tick, 700);
}

function enqueue(url: string) {
  const uid = modelUid(url) ?? randomUid();
  const existing = findJob(uid);
  if (existing && isInProgress(existing.phase)) return;

  if (existing) {
    existing.phase = "queued";
    existing.pct = 0;
    existing.error = undefined;
    existing.filename = undefined;
    existing.bytes = undefined;
    existing.meshCount = undefined;
    existing.imageCount = undefined;
    existing.name = "Sketchfab model";
    existing.thumbUrl = "";
    existing.log = [];
    appendLog(existing.log, { kind: "queued", text: "Added to queue" });
    touch(existing);
  } else {
    const job: DownloadJob = {
      id: uid,
      uid,
      name: "Demo Model " + (app.jobs.length + 1),
      url,
      thumbUrl: SAMPLE_THUMB,
      phase: "queued",
      pct: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      log: [],
    };
    appendLog(job.log, { kind: "queued", text: "Added to queue" });
    app.jobs.unshift(job);
  }
  app.pageUid = uid;
  app.pageUrl = url;
  startSimulation(uid);
}

export const mockBackend: Backend = {
  enqueue,
  async enqueueCollection(_uid: string) {
    throw new Error("Collections need the extension");
  },
  retry(job) {
    enqueue(job.url);
  },
  async clearHistory() {},
  async restoreHistory(_jobs: DownloadJob[]) {},
  saveSettings(_settings: Settings) {
    clearPageToastsIfDisabled();
  },
};

export function enqueueNewModel() {
  const uid = randomUid();
  enqueue(`https://sketchfab.com/3d-models/demo-model-${uid}`);
}

export function failActive() {
  const job = app.jobs.find((j) => isInProgress(j.phase));
  if (!job) {
    toast.info("Nothing in progress");
    return;
  }
  window.clearTimeout(simTimer);
  // Establish a loading toast so toastForJob can resolve it (seed jobs have none).
  toastForJob(job);
  job.phase = "error";
  job.error = "Simulated failure during convert.";
  closeOpenGroups(job.log, "error");
  appendLog(job.log, { kind: "error", text: job.error }, false);
  touch(job);
  toastForJob(job);
}
