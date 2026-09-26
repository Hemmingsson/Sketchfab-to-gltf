import { test } from "node:test";
import assert from "node:assert/strict";
import { pickThumbUrl } from "../src/lib/sf-api.js";

test("pickThumbUrl picks the smallest image at least 200 px wide", () => {
  const info = {
    thumbnails: {
      images: [64, 256, 720, 1024, 1920].map((width) => ({
        width,
        url: `https://example.com/${width}.jpg`,
      })),
    },
  };

  assert.equal(pickThumbUrl(info), "https://example.com/256.jpg");
});

test("pickThumbUrl picks the largest image when none reaches the minimum width", () => {
  const info = {
    thumbnails: {
      images: [
        { width: 64, url: "https://example.com/64.jpg" },
        { width: 128, url: "https://example.com/128.jpg" },
      ],
    },
  };

  assert.equal(pickThumbUrl(info), "https://example.com/128.jpg");
});

test("pickThumbUrl returns empty string for missing or empty thumbnails", () => {
  assert.equal(pickThumbUrl(), "");
  assert.equal(pickThumbUrl({}), "");
  assert.equal(pickThumbUrl({ thumbnails: { images: [] } }), "");
});
