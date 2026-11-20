import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePrefetched } from "../src/lib/sf-api.js";

/** The embed page HTML-escapes its prefetched JSON inside a comment. */
const embed = (json) =>
  `<div id="js-dom-data-prefetched-data"><!--${json
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&#34;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")}--></div>`;

test("decodes every HTML entity in names, not only quotes", () => {
  const data = parsePrefetched(
    embed(JSON.stringify({ "/i/models/abc": { name: `Davinci's Last Supper & <Co> "v2"` } })),
  );
  assert.equal(data["/i/models/abc"].name, `Davinci's Last Supper & <Co> "v2"`);
});

test("decodes in one pass: an escaped entity stays literal", () => {
  const data = parsePrefetched(embed(JSON.stringify({ k: { name: "R&#39;n'B" } })));
  assert.equal(data.k.name, "R&#39;n'B");
});

test("decodes numeric hex and decimal entities", () => {
  const html = `<div id="js-dom-data-prefetched-data"><!--{&#34;k&#34;:&#34;caf&#xe9; &#169;&#34;}--></div>`;
  assert.equal(parsePrefetched(html).k, "café ©");
});

test("throws on a page without prefetched data", () => {
  assert.throws(() => parsePrefetched("<html></html>"), /private\/deleted/);
});
