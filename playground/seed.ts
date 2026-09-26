import { createTextureLog, keyScanDone, keyScanProbe, type ProgressMeta } from "../src/lib/log-groups.js";
import { stageMilestone } from "../src/lib/milestones.js";
import { appendLog, classifyLine } from "../src/lib/progress.js";
import { exportFilename, sanitizeName } from "../src/lib/settings.js";
import type { DownloadJob, LogEntry, LogKind } from "../src/shared/types";

export const SAMPLE_THUMB =
  "https://media.sketchfab.com/models/b00a8be4c2a74c85a2b02482ec1bd205/thumbnails/b144c74a929444b08762dd15ad7f3ccb/f05b336cb7ea4f69a322f0abc726b829.jpeg";

let seq = 0;
export function nextId(prefix = "id") {
  seq += 1;
  return `${prefix}-${seq}`;
}

export function logEntry(
  kind: LogKind,
  text: string,
  opts: {
    active?: boolean;
    done?: boolean;
    at?: number;
    depth?: number;
  } = {}
): LogEntry {
  const { depth = 0, at = Date.now(), ...rest } = opts;
  return { id: nextId("log"), kind, text, depth, at, ...rest };
}

/** Sample texture names shaped like real Sketchfab CDN bases (bytes = download size). */
export const DEMO_TEXTURES = [
  { name: "Body_D.png", size: "2048x2048", bytes: 4_812_300 },
  { name: "Body_N.png", size: "2048x2048", bytes: 5_120_044 },
  { name: "Body_ORM.png", size: "2048x2048", bytes: 3_402_118 },
  { name: "Glass_D.png", size: "1024x1024", bytes: 912_400 },
  { name: "Decals_A.png", size: "64x64", bytes: 6_500 },
  { name: "Interior_D.jpg", size: "2048x2048", bytes: 1_804_210 },
  { name: "Interior_N.jpg", size: "2048x2048", bytes: 2_210_880 },
  { name: "Wheel_D.png", size: "1024x1024", bytes: 1_240_512 },
  { name: "Wheel_N.png", size: "1024x1024", bytes: 1_388_004 },
  { name: "Brake_D.png", size: "512x512", bytes: 402_110 },
  { name: "Lights_E.png", size: "1024x1024", bytes: 640_288 },
  { name: "Tyre_N.png", size: "1024x1024", bytes: 1_102_336 },
];

/** Same path as background's handleOffscreen: classify the line, then upsert it into the log. */
export function emitLine(log: LogEntry[], text: string, meta: ProgressMeta = {}) {
  const { kind, depth } = classifyLine(text) as { kind: LogKind; depth: number };
  appendLog(log, { kind, text, depth, ...meta });
}

/** Run the pipeline's own emitters against a fresh log and return its entries. */
function emitted(run: (emit: (text: string, meta?: ProgressMeta) => void) => void): LogEntry[] {
  const log: LogEntry[] = [];
  run((text, meta) => emitLine(log, text, meta));
  return log;
}

/** Closed key-scan row after `probes` viewer scripts. */
function closedKeyScan(probes: number): LogEntry[] {
  return emitted((emit) => {
    for (let i = 0; i < probes; i++) emit(...keyScanProbe(`viewer-${i}.js`));
    emit(...keyScanDone("71c5b342a9e0d6f1", probes));
  });
}

type Texture = { name: string; size: string; bytes: number };

/** Finish one texture row the way fetchTextures does (`pk` null = passthrough). */
function finishTexture(
  row: ReturnType<ReturnType<typeof createTextureLog>["start"]>,
  t: Texture,
  pk: number | null
) {
  const [width, height] = t.size.split("x").map(Number);
  if (pk === null) row.step("passthrough");
  else row.progress(`descramble ${width}x${height} pk=${pk}`);
  row.done({
    width,
    height,
    inBytes: t.bytes,
    outBytes: pk === null ? t.bytes : Math.round(t.bytes * 1.08),
    fromDescramble: pk !== null,
    pk,
  });
}

/** Closed `textures` group plus one closed child row per texture (index 4 passthrough, 9 warn). */
function closedTextureGroup(): LogEntry[] {
  return emitted((emit) => {
    const tex = createTextureLog(DEMO_TEXTURES.length, emit);
    DEMO_TEXTURES.forEach((t, i) => {
      const row = tex.start(t.name);
      if (i === 9) row.step("descramble ok · checksum mismatch", "warn");
      finishTexture(row, t, i === 4 ? null : (i * 37) % 97);
    });
    tex.finish();
  });
}

/** Open `textures` group: 3 of 8 finished, 2 descrambling. */
function activeTextureGroup(): LogEntry[] {
  return emitted((emit) => {
    const tex = createTextureLog(8, emit);
    [
      { name: "Hull_D.png", size: "2048x2048", bytes: 4_120_004 },
      { name: "Hull_N.png", size: "2048x2048", bytes: 4_600_118 },
      { name: "Hull_ORM.png", size: "2048x2048", bytes: 3_010_552 },
    ].forEach((t, i) => finishTexture(tex.start(t.name), t, 17 + i));
    for (const name of ["Wood_D.jpg", "Wood_N.jpg"]) tex.start(name).step("descrambling");
  });
}

/** Seed history matching real pipeline log language + nested detail lines. */
export function createSeedJobs(): DownloadJob[] {
  const now = Date.now();

  const survoltUid = "b00a8be4c2a74c85a2b02482ec1bd205";
  const survoltName = "2010 Citroën DS Survolt";
  const survoltBytes = 8_098_996;
  const survoltFile = exportFilename({
    name: sanitizeName(survoltName),
    uid: survoltUid,
  });
  const done: DownloadJob = {
    id: survoltUid,
    uid: survoltUid,
    name: survoltName,
    url: "https://sketchfab.com/3d-models/2010-citroen-ds-survolt-b00a8be4c2a74c85a2b02482ec1bd205",
    thumbUrl: SAMPLE_THUMB,
    phase: "done",
    pct: 100,
    bytes: survoltBytes,
    meshCount: 59,
    imageCount: 12,
    filename: survoltFile,
    createdAt: now - 120_000,
    updatedAt: now - 90_000,
    log: [
      logEntry("info", "UID: b00a8be4c2a74c85a2b02482ec1bd205", { at: now - 120_000 }),
      logEntry("reading", "Reading public viewer…", { at: now - 119_000 }),
      logEntry("info", "Model: 2010 Citroën DS Survolt (by Ddiaz Design)", {
        at: now - 118_000,
      }),
      logEntry("info", "Viewer materials: 12", { at: now - 117_000 }),
      ...closedKeyScan(20),
      logEntry("decrypt", "Loading WASM decrypt module…", { at: now - 115_000 }),
      logEntry("detail", "WASM loaded (248 KB)", { depth: 1, at: now - 114_500 }),
      logEntry("download", "Downloading file.binz…", { at: now - 114_000 }),
      logEntry("detail", "→ file.osgjs (4859221 bytes)", { depth: 1, at: now - 113_000 }),
      logEntry("download", "Downloading model_file.binz…", { at: now - 112_500 }),
      logEntry("detail", "→ model_file.bin (3.1 MB)", { depth: 1, at: now - 111_000 }),
      logEntry("separator", stageMilestone("decrypting", "textures", {
        startedAt: now - 115_000,
        now: now - 108_500,
        bytes: 4_859_221 + 3_250_000,
      })!.text, { at: now - 108_500 }),
      logEntry("detail", "Textures API: optimized (12)", { depth: 1, at: now - 108_000 }),
      ...closedTextureGroup(),
      logEntry("detail", "NOTE: 1 texture(s) look unusually small (6500 B)", {
        depth: 1,
        at: now - 100_600,
      }),
      logEntry("detail", "12 texture(s) ready for GLB embed", {
        depth: 1,
        at: now - 100_500,
      }),
      logEntry("separator", stageMilestone("textures", "packing", {
        startedAt: now - 108_500,
        now: now - 100_200,
      })!.text, { at: now - 100_200 }),
      logEntry("pack", "Packing ORM maps…", { at: now - 100_000 }),
      logEntry("detail", "Packed 4 ORM map(s) from separate metal/rough maps", {
        depth: 1,
        at: now - 99_000,
      }),
      logEntry("convert", "Converting osgjs → glTF (GLB)…", { at: now - 96_000 }),
      logEntry(
        "detail",
        `GLB ready (${survoltBytes} bytes, 59 mesh(es), 12 image(s) embedded, 0 animation(s))`,
        { depth: 1, at: now - 94_000 },
      ),
      logEntry("separator", stageMilestone("converting", "saving", {
        startedAt: now - 96_000,
        now: now - 93_000,
        bytes: survoltBytes,
      })!.text, { at: now - 93_000 }),
      logEntry("save", `Saving ${survoltFile}…`, { at: now - 92_000 }),
      logEntry("done", `Saved ${survoltFile}`, { at: now - 90_000 }),
    ],
  };

  const rowboatUid = "27e4cc118523482e876b5e9b8723154c";
  const active: DownloadJob = {
    id: rowboatUid,
    uid: rowboatUid,
    name: "Rowboat",
    url: "https://sketchfab.com/3d-models/rowboat-27e4cc118523482e876b5e9b8723154c",
    thumbUrl: SAMPLE_THUMB,
    phase: "textures",
    pct: 64,
    createdAt: now - 40_000,
    updatedAt: now - 2_000,
    log: [
      logEntry("queued", "Added to queue", { at: now - 40_000 }),
      logEntry("reading", "Reading public viewer…", { at: now - 38_000 }),
      logEntry("info", "Model: Rowboat (by Sketchfab demo)", { at: now - 37_000 }),
      logEntry("decrypt", "Decrypting model_file.binz…", { at: now - 30_000 }),
      logEntry("detail", "→ model_file.bin (890 KB)", { depth: 1, at: now - 28_000 }),
      logEntry("separator", stageMilestone("decrypting", "textures", {
        startedAt: now - 30_000,
        now: now - 25_000,
      })!.text, { at: now - 25_000 }),
      ...activeTextureGroup(),
    ],
  };

  const failUid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const failed: DownloadJob = {
    id: failUid,
    uid: failUid,
    name: "Private Concept Car",
    url: "https://sketchfab.com/3d-models/private-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    thumbUrl: SAMPLE_THUMB,
    phase: "error",
    pct: 12,
    error: "Private or unsupported format.",
    createdAt: now - 300_000,
    updatedAt: now - 280_000,
    log: [
      logEntry("reading", "Reading public viewer…", { at: now - 300_000 }),
      logEntry("info", "Model: Private Concept Car", { at: now - 299_000 }),
      logEntry(
        "error",
        "Private or unsupported format.",
        { at: now - 280_000 }
      ),
    ],
  };

  return [active, done, failed];
}
