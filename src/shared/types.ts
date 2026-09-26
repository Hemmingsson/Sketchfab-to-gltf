export type JobPhase =
  | "idle" | "queued" | "reading" | "decrypting" | "textures" | "packing"
  | "converting" | "zipping" | "saving" | "done" | "error";

export type LogKind =
  | "queued" | "reading" | "decrypt" | "download" | "texture" | "pack" | "convert"
  | "zip" | "save" | "done" | "error" | "info" | "detail" | "separator";

export type LogEntry = {
  id: string;
  kind: LogKind;
  text: string;
  /** 0 = phase header, 1 = nested detail. */
  depth?: number;
  active?: boolean;
  /** Nested detail finished (checkmark instead of dot). */
  done?: boolean;
  at: number;
  /** Upsert key: later lines with the same group update this entry in place. */
  group?: string;
  /** Group key of the parent row (e.g. "textures"); the UI nests, the log stays flat. */
  parent?: string;
  /** Number of lines folded into this grouped entry (1 on creation). */
  count?: number;
  /** Secondary text (e.g. raw line or size) shown on expand. */
  detail?: string;
  /** Set when a grouped row closes; an open grouped row has none. */
  status?: LogStatus;
  /** Parent row: number of child rows expected (e.g. texture maps). */
  total?: number;
  /** Parent row: children finished without a row of their own. */
  skipped?: number;
  /** Texture child row, set when it finishes. */
  width?: number;
  height?: number;
  inBytes?: number;
  outBytes?: number;
};

export type LogStatus = "done" | "warn" | "error";

export type DownloadJob = {
  /** Always equal to `uid` in the extension (one job per model). */
  id: string;
  uid: string;
  url: string;
  name: string;
  /** "" until the pipeline reports meta. */
  thumbUrl: string;
  phase: JobPhase;
  /** 0–100, fractional while smoothing. Round for display. */
  pct: number;
  error?: string;
  filename?: string;
  bytes?: number;
  meshCount?: number;
  imageCount?: number;
  log: LogEntry[];
  /** Set when a collection click queued this job; the page shows one toast per batch. */
  batch?: JobBatch;
  createdAt: number;
  updatedAt: number;
};

/** One "Download all" run: `id` is the collection uid, `startedAt` tells runs apart. */
export type JobBatch = { id: string; name: string; startedAt: number };

export type Route = { name: "list" } | { name: "detail"; jobId: string } | { name: "settings" };

/** User-facing download format. Debug ZIP overrides this when enabled. */
export type ExportFormat = "glb" | "gltf-zip";

/** Cap texture download edge; `0` keeps the largest available map. */
export type TextureSize = 0 | 2048 | 4096;

export type Settings = {
  askWhereToSave: boolean;
  debugZip: boolean;
  exportFormat: ExportFormat;
  maxTextureEdge: TextureSize;
  /** Embed Sketchfab viewer camera + punctual lights in the glTF. */
  includeViewerScene: boolean;
  /** Append an 8-char model id to the download name (`Model-a1b2c3d4.glb` / `.gltf`). */
  uidInFilename: boolean;
  /** Progress / result toasts on the Sketchfab page. */
  pageToasts: boolean;
};

export type PipelineMeta = { name: string; author: string; thumbUrl: string };
