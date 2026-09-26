import { test } from "node:test";
import assert from "node:assert/strict";
import { collectionModelUrls } from "../src/lib/collection.js";
import { collectionUid } from "../src/lib/model-url.js";

const UID = "603b87cc28374434a5331870a56674e1";
const A = "0123456789abcdef0123456789abcdef";
const B = "fedcba9876543210fedcba9876543210";

test("collectionUid reads collection page URLs", () => {
  assert.equal(collectionUid(`https://sketchfab.com/Chr1stophery/collections/pirate-game-${UID}`), UID);
  assert.equal(collectionUid(`https://sketchfab.com/u/collections/x-${UID.toUpperCase()}?sort_by=-likeCount`), UID);
  assert.equal(collectionUid(`https://sketchfab.com/3d-models/x-${UID}`), null);
  assert.equal(collectionUid(`https://sketchfab.com/u/collections`), null);
});

test("collectionModelUrls follows next and skips non-model entries", async () => {
  const first = `https://sketchfab.com/i/collections/${UID}/models?count=24`;
  const second = `${first}&cursor=abc`;
  const pages = {
    [first]: { results: [{ viewerUrl: `https://sketchfab.com/3d-models/a-${A}` }, { viewerUrl: "" }], next: second },
    [second]: { results: [{ viewerUrl: `https://sketchfab.com/3d-models/b-${B}` }], next: null },
  };
  const seen = [];
  const urls = await collectionModelUrls(UID, async (url) => {
    seen.push(url);
    return pages[url];
  });
  assert.deepEqual(seen, [first, second]);
  assert.deepEqual(urls, [`https://sketchfab.com/3d-models/a-${A}`, `https://sketchfab.com/3d-models/b-${B}`]);
});

test("collectionModelUrls ignores a next cursor off the collection API", async () => {
  const urls = await collectionModelUrls(UID, async () => ({
    results: [{ viewerUrl: `https://sketchfab.com/3d-models/a-${A}` }],
    next: "https://example.com/evil",
  }));
  assert.equal(urls.length, 1);
});
