import { test } from "node:test";
import assert from "node:assert/strict";
import { isHexUid, modelUid } from "../src/lib/model-url.js";
import { extractUid } from "../src/lib/sf-api.js";

const UID = "0123456789abcdef0123456789abcdef";

test("modelUid reads slug and /models/ URLs", () => {
  assert.equal(modelUid(`https://sketchfab.com/3d-models/old-chair-${UID}`), UID);
  assert.equal(modelUid(`https://www.sketchfab.com/models/${UID}/embed?autostart=1`), UID);
  assert.equal(modelUid(`https://sketchfab.com/3d-models/x-${UID.toUpperCase()}#comments`), UID);
});

test("modelUid rejects non-model URLs and bare hex", () => {
  assert.equal(modelUid(`https://sketchfab.com/search?q=${UID}`), null);
  assert.equal(modelUid(`https://example.com/models/${UID}`), null);
  assert.equal(modelUid(UID), null);
  assert.equal(modelUid(undefined), null);
});

test("isHexUid accepts a 32-hex uid only", () => {
  assert.equal(isHexUid(UID), true);
  assert.equal(isHexUid(UID.toUpperCase()), true);
  assert.equal(isHexUid(`${UID}0`), false);
  assert.equal(isHexUid(""), false);
});

test("extractUid still accepts a bare uid", () => {
  assert.equal(extractUid(UID), UID);
  assert.equal(extractUid(`https://sketchfab.com/3d-models/a-${UID}`), UID);
});
