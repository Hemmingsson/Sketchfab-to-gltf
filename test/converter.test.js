import { test } from "node:test";
import assert from "node:assert/strict";
import { createConverter } from "../src/lib/converter.js";

const run = (id, extra = {}) => ({
  target: "offscreen",
  action: "run",
  id,
  url: `https://sketchfab.com/3d-models/x-${id}`,
  debugZip: false,
  exportFormat: "glb",
  maxTextureEdge: 0,
  includeViewerScene: true,
  uidInFilename: true,
  ...extra,
});

/** A converter on a fake pipeline; `finish` resolves the pending download. */
function setup() {
  const events = [];
  let finish;
  let calls = 0;
  const downloadModel = (_url, onProgress, opts) => {
    calls++;
    onProgress("Reading model");
    opts.onMeta({ name: "Chair", thumbUrl: "" });
    return new Promise((resolve, reject) => (finish = { resolve, reject }));
  };
  const conv = createConverter({ downloadModel, emit: (e) => events.push(e) });
  return { conv, events, finish: () => finish, calls: () => calls };
}

const tick = () => new Promise((r) => setImmediate(r));

test("run acks, starts the pipeline once, and reports progress and meta", async () => {
  const { conv, events, calls } = setup();
  assert.deepEqual(await conv.handle(run("a")), { ok: true });
  // A resend of a running job is acked but not rerun.
  assert.deepEqual(await conv.handle(run("a")), { ok: true });
  await tick();
  assert.equal(calls(), 1);
  assert.deepEqual(
    events.map((e) => [e.source, e.id, e.kind]),
    [
      ["sf-offscreen", "a", "progress"],
      ["sf-offscreen", "a", "progress"],
      ["sf-offscreen", "a", "meta"],
    ],
  );
  assert.equal(events[0].text, "Converter started");
  assert.equal(events[2].name, "Chair");
});

test("done emits a blob URL whose bytes refetchBytes returns until revoked", async () => {
  const { conv, events, finish } = setup();
  await conv.handle(run("b"));
  finish().resolve({ filename: "chair.glb", bytes: new Uint8Array([1, 2, 3]), kind: "glb", meshCount: 1, imageCount: 0 });
  await tick();
  const done = events.find((e) => e.kind === "done");
  assert.match(done.blobUrl, /^blob:/);
  assert.equal(done.bytes, 3);
  assert.deepEqual(await conv.handle({ target: "offscreen", action: "refetchBytes", id: "b" }), {
    ok: true,
    base64: "AQID",
    mime: "model/gltf-binary",
  });
  await conv.handle({ target: "offscreen", action: "revoke", id: "b" });
  assert.deepEqual(await conv.handle({ target: "offscreen", action: "refetchBytes", id: "b" }), { ok: false });
});

test("a pipeline error is emitted, and the job can run again", async () => {
  const { conv, events, finish, calls } = setup();
  await conv.handle(run("c"));
  finish().reject(new Error("HTTP 404"));
  await tick();
  assert.equal(events.at(-1).kind, "error");
  assert.equal(events.at(-1).error, "HTTP 404");
  await conv.handle(run("c"));
  assert.equal(calls(), 2);
});

test("messages for other targets are ignored", async () => {
  const { conv, calls } = setup();
  assert.equal(await conv.handle({ target: "popup", action: "run", id: "d" }), undefined);
  assert.equal(calls(), 0);
});

test("a new result with the same id gets its own expiry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { conv, finish } = setup();
  const result = (value) => ({ filename: "chair.glb", bytes: new Uint8Array([value]), kind: "glb" });

  await conv.handle(run("reused"));
  finish().resolve(result(1));
  await tick();
  t.mock.timers.tick(119_000);

  await conv.handle(run("reused"));
  finish().resolve(result(2));
  await tick();
  t.mock.timers.tick(1_000);
  const current = await conv.handle({ target: "offscreen", action: "refetchBytes", id: "reused" });
  assert.equal(current.ok, true);
  assert.equal(current.base64, "Ag==");

  t.mock.timers.tick(119_000);
  assert.deepEqual(await conv.handle({ target: "offscreen", action: "refetchBytes", id: "reused" }), { ok: false });
});
