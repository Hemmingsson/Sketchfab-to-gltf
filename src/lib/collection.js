import { modelUid } from "./model-url.js";

const API = "https://sketchfab.com/i/collections/";
/** 100 pages × 24 = 2400 models; stops a bad cursor from looping forever. */
const MAX_PAGES = 100;

/**
 * Model page URLs of a public collection, in collection order.
 * Follows the listing's `next` cursor; `fetchJson(url)` returns the parsed page.
 */
export async function collectionModelUrls(uid, fetchJson) {
  const urls = [];
  let next = `${API}${uid}/models?count=24`;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const data = await fetchJson(next);
    for (const m of data?.results ?? []) {
      if (modelUid(m?.viewerUrl)) urls.push(m.viewerUrl);
    }
    next = typeof data?.next === "string" && data.next.startsWith(API) ? data.next : null;
  }
  return urls;
}
