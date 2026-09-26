/**
 * Theatre.js timeline for the route transitions in
 * src/shared/view-transitions.css. Loaded only by the playground's
 * tuner.html page — never shipped.
 *
 * Each phase is one track with two keyframes: the first sits at the phase's
 * start (`--vt-<phase>-at`), the second at its end (`-dur`), and the curve
 * between them is its easing (`-ease`). Drag keyframes or edit the curve in
 * the graph editor; the CSS custom properties on :root follow.
 *
 * Pick a transition under Preview → scrub to hold it paused; the playhead then
 * scrubs the real view transition in the popup.
 *
 * Defaults come from the CSS. Edits persist in this browser (Theatre keeps
 * them in localStorage); "Copy transition CSS" exports them as a :root block.
 */
import { getProject, onChange, types } from "@theatre/core";
import studioModule from "@theatre/studio";
import { tick } from "svelte";
import { app, goDetail, goList, goSettings } from "../src/shared/store.svelte";

// Theatre ships CommonJS; Vite's interop can hand back `{ default: studio }`.
const studio =
  (studioModule as unknown as { default?: typeof studioModule }).default ?? studioModule;

const PROJECT = "Popup timeline";
const SHEET = "Route";
/** Timeline resolution: 100 sub-units per second = 10 ms steps. */
const SUB_UNITS = 100;

/** Phases shown as tracks, keyed by their CSS token prefix. */
const PHASES = [
  { token: "open-hero", track: "Open / Hero rise" },
  { token: "open-exit", track: "Open / Rows exit" },
  { token: "open-reveal", track: "Open / Log reveal" },
  { token: "close-hide", track: "Close / Log hide" },
  { token: "close-return", track: "Close / Hero + rows return" },
  { token: "settings", track: "Settings / Slide" },
] as const;

type Bezier = [number, number, number, number];
type Phase = { at: number; dur: number; ease: Bezier };
type Keyframe = {
  id: string;
  position: number;
  value: number;
  handles: [number, number, number, number];
  connectedRight: boolean;
  type: "bezier";
};

const root = document.documentElement;
const css = getComputedStyle(root);
const cssValue = (name: string) => css.getPropertyValue(name).trim();
const msOf = (name: string) => parseFloat(cssValue(name)) || 0;

function bezierOf(name: string): Bezier {
  const n = (cssValue(name).match(/-?[\d.]+/g) ?? []).map(Number);
  return n.length === 4 ? (n as Bezier) : [0.25, 0.1, 0.25, 1];
}

function phaseFromCss(token: string): Phase {
  return {
    at: msOf(`--vt-${token}-at`),
    dur: msOf(`--vt-${token}-dur`),
    ease: bezierOf(`--vt-${token}-ease`),
  };
}

const round = (n: number, step = 1000) => Math.round(n * step) / step;

/** Two keyframes per phase; Theatre's bezier uses k0's right handle and k1's left. */
function keyframesFor(p: Phase, token: string): Keyframe[] {
  const [x1, y1, x2, y2] = p.ease;
  return [
    {
      id: `${token}-start`,
      position: round(p.at / 1000),
      value: 0,
      handles: [0.5, 1, x1, y1],
      connectedRight: true,
      type: "bezier",
    },
    {
      id: `${token}-end`,
      position: round((p.at + p.dur) / 1000),
      value: 1,
      handles: [x2, y2, 0.5, 0],
      connectedRight: false,
      type: "bezier",
    },
  ];
}

const PROP_PATH = JSON.stringify(["progress"]);

/** Initial project state built from the CSS defaults (used until the user edits). */
function initialState() {
  const tracksByObject: Record<string, unknown> = {};
  for (const { token, track } of PHASES) {
    tracksByObject[track] = {
      trackIdByPropPath: { [PROP_PATH]: token },
      trackData: {
        [token]: {
          type: "BasicKeyframedTrack",
          __debugName: `${track}:${PROP_PATH}`,
          keyframes: keyframesFor(phaseFromCss(token), token),
        },
      },
    };
  }
  return {
    sheetsById: {
      [SHEET]: {
        staticOverrides: { byObject: {} },
        sequence: {
          type: "PositionalSequence",
          length: 1,
          subUnitsPerUnit: SUB_UNITS,
          tracksByObject,
        },
      },
    },
    definitionVersion: "0.4.0",
    revisionHistory: [],
  };
}

studio.initialize();
const project = getProject(PROJECT, { state: initialState() });
const sheet = project.sheet(SHEET);

const phaseObjects = PHASES.map(({ track }) =>
  sheet.object(track, { progress: types.number(0, { range: [0, 1] }) })
);

const SCRUB = {
  auto: "Auto (selected track's transition)",
  off: "Off (play normally)",
  "detail-open": "List → detail",
  "detail-close": "Detail → list",
  "settings-open": "List → settings",
  "settings-close": "Settings → list",
} as const;
type Scrub = keyof typeof SCRUB;

const preview = sheet.object("Preview", {
  scrub: types.stringLiteral("auto", SCRUB),
  /** Playback rate for view transitions while not scrubbing; 0.1 = 10× slower. */
  slowMotion: types.number(1, { range: [0.05, 1], nudgeMultiplier: 0.05 }),
  fadeMs: types.number(msOf("--vt-fade"), { range: [0, 600], nudgeMultiplier: 10 }),
  maskEdge: types.number(msOf("--vt-mask-edge"), { range: [0, 60] }),
  recede: types.number(msOf("--vt-recede"), { range: [-100, 0] }),
});

// ── Timeline → CSS ──────────────────────────────────────────

type SavedTrack = { keyframes?: Keyframe[] };
type SavedObject = { trackIdByPropPath?: Record<string, string>; trackData?: Record<string, SavedTrack> };

function readPhases(): Record<string, Phase> {
  const out: Record<string, Phase> = {};
  let saved: { sheetsById?: Record<string, { sequence?: { tracksByObject?: Record<string, SavedObject> } }> };
  try {
    saved = studio.createContentOfSaveFile(PROJECT) as typeof saved;
  } catch {
    return out;
  }
  const tracks = saved.sheetsById?.[SHEET]?.sequence?.tracksByObject ?? {};
  for (const { token, track } of PHASES) {
    const obj = tracks[track];
    const id = obj?.trackIdByPropPath?.[PROP_PATH];
    const kfs = [...((id && obj?.trackData?.[id]?.keyframes) || [])].sort((a, b) => a.position - b.position);
    if (kfs.length < 2) continue;
    const [k0, k1] = kfs;
    out[token] = {
      at: Math.round(k0.position * 1000),
      dur: Math.round((k1.position - k0.position) * 1000),
      ease: [k0.handles[2], k0.handles[3], k1.handles[0], k1.handles[1]].map((n) => round(n, 100)) as Bezier,
    };
  }
  return out;
}

let current: Record<string, string> = {};

function tokens(): Record<string, string> {
  const t: Record<string, string> = {};
  for (const [token, p] of Object.entries(readPhases())) {
    t[`--vt-${token}-at`] = `${p.at}ms`;
    t[`--vt-${token}-dur`] = `${Math.max(0, p.dur)}ms`;
    t[`--vt-${token}-ease`] = `cubic-bezier(${p.ease.join(", ")})`;
  }
  const v = preview.value;
  t["--vt-fade"] = `${Math.round(v.fadeMs)}ms`;
  t["--vt-mask-edge"] = `${round(v.maskEdge, 10)}%`;
  t["--vt-recede"] = `${round(v.recede, 10)}%`;
  return t;
}

function sync() {
  const next = tokens();
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  for (const [name, value] of Object.entries(next)) root.style.setProperty(name, value);
}

// Theatre has no public "keyframes changed" event; a cheap poll covers drags and curve edits.
project.ready.then(() => {
  // Selected objects show their tracks in the sequence editor.
  studio.setSelection(phaseObjects);
  sync();
  setInterval(sync, 150);
});

// ── Scrubbing the real transition ───────────────────────────
//
// Moving the playhead holds a transition paused and seeks it. While held, the
// playground lets pointer events through the view-transition overlay
// (playground.css), so the timeline stays usable; a click on the page or Esc
// releases it.

type Transition = Exclude<Scrub, "auto" | "off">;

let held: Animation[] = [];
let heldMode: Transition | null = null;
/** Set while hold() starts its transition, so the wrapper knows to pause it. */
let holdNext = false;

const playhead = () => sheet.sequence.position * 1000;
const scrubMode = () => preview.value.scrub as Scrub;

/** In Auto, the transition follows the selected track's group (Open / Close / Settings). */
function wantedMode(): Transition | null {
  const mode = scrubMode();
  if (mode === "off") return null;
  if (mode !== "auto") return mode;
  const key = studio.selection.map((o) => ("objectKey" in o.address ? o.address.objectKey : "")).find((k) => /^(Open|Close|Settings) \//.test(k));
  if (key?.startsWith("Close")) return "detail-close";
  if (key?.startsWith("Settings")) return "settings-open";
  return "detail-open";
}

function vtAnimations(): Animation[] {
  return document.getAnimations().filter((a) => {
    const pseudo = (a.effect as KeyframeEffect | null)?.pseudoElement ?? "";
    return pseudo.startsWith("::view-transition");
  });
}

function seek() {
  const t = playhead();
  for (const a of held) a.currentTime = t;
}

function release() {
  // A paused animation stays paused through finish(); resume it so the transition can end.
  for (const a of held) {
    a.play();
    a.finish();
  }
  held = [];
  heldMode = null;
  root.classList.remove("vt-scrubbing");
}

const start = document.startViewTransition?.bind(document);
if (start) {
  document.startViewTransition = ((arg?: ViewTransitionUpdateCallback | StartViewTransitionOptions) => {
    const transition = start(arg);
    const holdThis = holdNext;
    transition.ready
      .then(() => {
        const anims = vtAnimations();
        if (!holdThis) {
          for (const a of anims) a.playbackRate = preview.value.slowMotion;
          return;
        }
        held = anims;
        for (const a of anims) a.pause();
        seek();
      })
      .catch(() => {});
    return transition;
  }) as typeof document.startViewTransition;
}

/** Put the popup in the transition's starting view without animating, then run it held. */
async function hold(mode: Transition) {
  release();
  const job = app.jobs[1] ?? app.jobs[0];
  if (!job && mode.startsWith("detail")) return;
  heldMode = mode;
  root.classList.add("vt-scrubbing");
  app.route =
    mode === "detail-close"
      ? { name: "detail", jobId: job.id }
      : mode === "settings-close"
        ? { name: "settings" }
        : { name: "list" };
  await tick();
  holdNext = true;
  if (mode === "detail-open") goDetail(job.id);
  else if (mode === "settings-open") goSettings();
  else goList();
  holdNext = false;
}

/** Hold the wanted transition (starting it if needed), then seek to the playhead. */
function scrub() {
  const mode = wantedMode();
  if (!mode) return;
  if (mode === heldMode && held.length) seek();
  else if (mode !== heldMode) void hold(mode);
}

onChange(sheet.sequence.pointer.position, scrub);

studio.onSelectionChange(() => {
  if (heldMode && wantedMode() !== heldMode) scrub();
});

// Leave scrubbing when the page itself is used. The studio root covers the whole
// viewport, so test for the page container (`data-tuner-page`) instead.
document.addEventListener(
  "pointerdown",
  (e) => {
    if (!heldMode) return;
    const onPage = e.composedPath().some((n) => n instanceof Element && n.hasAttribute("data-tuner-page"));
    if (onPage) release();
  },
  true
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && heldMode) release();
});

let lastScrub = scrubMode();
preview.onValuesChange(() => {
  const mode = scrubMode();
  if (mode !== lastScrub) {
    lastScrub = mode;
    if (mode === "off") release();
    else scrub();
  }
  sync();
});

/** The current values as a :root block to paste into view-transitions.css. */
export function tokensCss(): string {
  const lines = Object.entries(tokens()).map(([k, v]) => `  ${k}: ${v};`);
  return `:root {\n${lines.join("\n")}\n}`;
}
