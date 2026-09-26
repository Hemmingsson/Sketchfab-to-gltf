import { parseSettings as parseSettingsJs } from "../lib/settings.js";
import type {
  DownloadJob,
  ExportFormat,
  JobPhase,
  LogEntry,
  LogKind,
  PipelineMeta,
  Settings,
  TextureSize,
} from "./types";

export const HISTORY_KEY = "sf_history_v2";
export const SESSION_KEY = "sf_active";
export const SETTINGS_KEY = "sf_settings";

/** Stored value under SETTINGS_KEY; missing or partial values read as defaults. */
export function parseSettings(raw: unknown): Settings {
  return parseSettingsJs(raw);
}

/** Popup / content → background. */
export type UiRequest =
  | { action: "enqueueDownload"; url: string }
  /** Queue every model in a collection (background lists it). */
  | { action: "enqueueCollection"; uid: string }
  /** `lite` drops finished jobs' logs (the page only needs phase and progress). */
  | { action: "getJobs"; lite?: boolean }
  | { action: "clearHistory" }
  | { action: "restoreHistory"; jobs: DownloadJob[] };

export type GetJobsReply = { ok: true; jobs: DownloadJob[] };
/** No error arm: the UI only enqueues URLs it has already parsed, so it has nothing to report. */
export type EnqueueReply = { ok: true; id: string };
export type EnqueueCollectionReply = { ok: true; uids: string[] } | { ok: false; error: string };

/** Reply shape per request action; a request with no receiver resolves undefined. */
export type UiReply = {
  enqueueDownload: EnqueueReply;
  enqueueCollection: EnqueueCollectionReply;
  getJobs: GetJobsReply;
  clearHistory: { ok: boolean };
  restoreHistory: { ok: boolean };
};

/** Background → popup (runtime.sendMessage) and → the tab that started the job (tabs.sendMessage). */
export type JobUpdate = { type: "jobUpdate"; job: DownloadJob };

/** Same recipients as JobUpdate: a smoother tick, no log. Ignored for jobs the receiver does not hold. */
export type JobPatch = { type: "jobPatch"; id: string } & Pick<DownloadJob, "pct" | "updatedAt">;

/** Background → offscreen. */
export type OffscreenRequest =
  | {
      target: "offscreen";
      action: "run";
      id: string;
      url: string;
      debugZip: boolean;
      exportFormat: ExportFormat;
      maxTextureEdge: TextureSize;
      includeViewerScene: boolean;
      uidInFilename: boolean;
    }
  | { target: "offscreen"; action: "refetchBytes"; id: string }
  | { target: "offscreen"; action: "revoke"; id: string };

/**
 * Group fields of a pipeline progress line (see src/lib/log-groups.js).
 * `group` upserts one log row; any `status` closes it.
 */
export type ProgressGroupMeta = Pick<
  LogEntry,
  "group" | "parent" | "detail" | "status" | "total" | "skipped" | "width" | "height" | "inBytes" | "outBytes"
>;

/** Offscreen → background. */
export type OffscreenEvent = { source: "sf-offscreen"; id: string } & (
  | { kind: "progress"; phase: JobPhase; text: string; logKind: LogKind; depth: number; meta?: ProgressGroupMeta }
  | ({ kind: "meta" } & PipelineMeta)
  | { kind: "done"; blobUrl: string; filename: string; bytes: number; meshCount: number; imageCount: number }
  | { kind: "error"; error: string }
);
