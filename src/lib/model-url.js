/** 32-hex Sketchfab uid (model, collection, or texture image). */
export const HEX_UID_RE = /^[a-f0-9]{32}$/i;

export function isHexUid(value) {
  return HEX_UID_RE.test(String(value || ""));
}

/** Model page URL: `/3d-models/<slug>-<uid>` or `/models/<uid>`. */
const MODEL_URL_RE = /sketchfab\.com\/(?:3d-models\/[^/?#]+-|models\/)([a-f0-9]{32})/i;

/** Lowercase model uid from a Sketchfab model page URL, else null. */
export function modelUid(url) {
  const m = MODEL_URL_RE.exec(String(url || ""));
  return m ? m[1].toLowerCase() : null;
}

/** Collection page URL: `/<user>/collections/<slug>-<uid>`. */
const COLLECTION_URL_RE = /sketchfab\.com\/[^/?#]+\/collections\/(?:[^/?#]*-)?([a-f0-9]{32})(?=[/?#]|$)/i;

/** Lowercase collection uid from a Sketchfab collection page URL, else null. */
export function collectionUid(url) {
  const m = COLLECTION_URL_RE.exec(String(url || ""));
  return m ? m[1].toLowerCase() : null;
}
