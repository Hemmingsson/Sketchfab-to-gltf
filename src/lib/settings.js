/**
 * Settings parsers and export naming. Plain JS so unit tests import without a build.
 */

/** @typedef {"glb" | "gltf-zip"} ExportFormat */
/** @typedef {0 | 2048 | 4096} TextureSize */
/**
 * @typedef {{
 *   askWhereToSave: boolean,
 *   debugZip: boolean,
 *   exportFormat: ExportFormat,
 *   maxTextureEdge: TextureSize,
 *   includeViewerScene: boolean,
 *   uidInFilename: boolean,
 *   pageToasts: boolean,
 * }} Settings
 */

/** Texture-size caps in Settings. None selected keeps original size (`0`). */
export const TEXTURE_SIZE_OPTIONS = /** @type {const} */ ([
  { value: 4096, label: "4K", hint: "4096px" },
  { value: 2048, label: "2K", hint: "2048px" },
]);

/**
 * @param {unknown} raw
 * @returns {ExportFormat}
 */
export function parseExportFormat(raw) {
  return raw === "gltf-zip" ? "gltf-zip" : "glb";
}

/**
 * @param {unknown} raw
 * @returns {TextureSize}
 */
export function parseTextureSize(raw) {
  return raw === 2048 || raw === 4096 ? raw : 0;
}

/**
 * Stored settings blob; missing or partial values read as defaults.
 * @param {unknown} raw
 * @returns {Settings}
 */
export function parseSettings(raw) {
  const s = raw && typeof raw === "object" ? /** @type {Partial<Settings>} */ (raw) : {};
  return {
    askWhereToSave: !!s.askWhereToSave,
    debugZip: !!s.debugZip,
    exportFormat: parseExportFormat(s.exportFormat),
    maxTextureEdge: parseTextureSize(s.maxTextureEdge),
    // Defaults stay on when the key is missing (older storage blobs).
    includeViewerScene: s.includeViewerScene !== false,
    uidInFilename: s.uidInFilename !== false,
    pageToasts: s.pageToasts !== false,
  };
}

/**
 * Filesystem-safe stem for export filenames.
 * @param {unknown} name
 * @returns {string}
 */
export function sanitizeName(name) {
  return (
    String(name || "model")
      .replace(/[^\w\-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "model"
  );
}

/**
 * Download basename for the chosen format. `sourceZip` (the raw-mesh fallback
 * when conversion fails) wins over `debugZip`, which wins over the format.
 * @param {{
 *   name: string,
 *   uid: string,
 *   uidInFilename?: boolean,
 *   exportFormat?: ExportFormat,
 *   debugZip?: boolean,
 *   sourceZip?: boolean,
 * }} opts
 * @returns {string}
 */
export function exportFilename({
  name,
  uid,
  uidInFilename = true,
  exportFormat = "glb",
  debugZip = false,
  sourceZip = false,
}) {
  const uid8 = String(uid || "").slice(0, 8);
  const stem = uidInFilename && uid8 ? `${name}-${uid8}` : name;
  if (sourceZip) return `${stem}-source.zip`;
  if (debugZip) return `${stem}-debug.zip`;
  if (exportFormat === "gltf-zip") return `${stem}-gltf.zip`;
  return `${stem}.glb`;
}

/**
 * Format name for UI copy. Exact caps: `GLB` or `glTF` (Debug ZIP wins).
 * @param {{ exportFormat?: ExportFormat, debugZip?: boolean }} settings
 * @returns {string}
 */
export function exportFormatWord(settings = {}) {
  if (settings.debugZip) return "Debug ZIP";
  if (settings.exportFormat === "gltf-zip") return "glTF";
  return "GLB";
}

/**
 * Extension token for UI copy. Exact form: `.glb` or `.gltf`.
 * @param {{ exportFormat?: ExportFormat }} settings
 * @returns {".glb" | ".gltf"}
 */
export function exportFormatExt(settings = {}) {
  return settings.exportFormat === "gltf-zip" ? ".gltf" : ".glb";
}

/**
 * FileIcon kind for the chosen export format.
 * @param {{ exportFormat?: ExportFormat }} settings
 * @returns {"glb" | "gltf"}
 */
export function exportIconKind(settings = {}) {
  return settings.exportFormat === "gltf-zip" ? "gltf" : "glb";
}

/**
 * Success toast / done-row headline from the saved filename.
 * @param {{ filename?: string }} job
 * @returns {string}
 */
export function savedHeadline(job) {
  const name = job.filename || "";
  if (name.endsWith("-debug.zip")) return "Debug ZIP saved";
  if (name.endsWith("-gltf.zip")) return "glTF ready";
  if (name.endsWith(".zip")) return "ZIP saved";
  return "GLB ready";
}
