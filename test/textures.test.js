import { test } from "node:test";
import assert from "node:assert/strict";
import { pickBestImage } from "../src/lib/sf-api.js";

function im(w, h, extra = {}) {
  return { width: w, height: h, url: `${w}.jpg`, size: w * h, ...extra };
}

test("pickBestImage respects maxEdge, fallback, and PNG preference", () => {
  assert.equal(pickBestImage([im(512, 512), im(2048, 2048), im(8192, 8192)]).width, 8192);
  assert.equal(pickBestImage([im(512, 512), im(2048, 2048), im(8192, 8192)], 2048).width, 2048);
  assert.equal(pickBestImage([im(4096, 4096), im(8192, 8192)], 2048).width, 4096);
  assert.equal(pickBestImage([im(512, 512), im(8192, 8192)], "nope").width, 8192);
  assert.equal(pickBestImage([im(2048, 2048), im(4096, 4096), im(8192, 8192)], 4096).width, 4096);
  const png = pickBestImage([
    im(2048, 2048, { url: "a.jpg", size: 900000 }),
    im(2048, 2048, { url: "a.png", size: 800000 }),
  ]);
  assert.ok(png.url.endsWith(".png"));
});
