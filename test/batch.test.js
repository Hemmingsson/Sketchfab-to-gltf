import { test } from "node:test";
import assert from "node:assert/strict";
import { batchBusyLine, batchFolder, batchProgress } from "../src/lib/batch.js";

const job = (uid, phase, startedAt, name = uid) => ({ uid, name, phase, batch: { id: "c1", name: "Pirate Game", startedAt } });

test("batchProgress counts the latest run only", () => {
  const jobs = [
    job("a", "done", 1),
    job("b", "done", 2),
    job("c", "error", 2),
    job("d", "textures", 2, "Ship"),
    job("e", "queued", 2),
    { uid: "f", phase: "done" },
  ];
  assert.deepEqual(batchProgress(jobs, "c1"), {
    name: "Pirate Game",
    startedAt: 2,
    total: 4,
    finished: 2,
    saved: 1,
    failed: 1,
    running: true,
    current: "Ship",
  });
  assert.equal(batchProgress(jobs, "other"), null);
});

test("batchProgress settles when nothing is in progress", () => {
  const p = batchProgress([job("a", "done", 1), job("b", "error", 1)], "c1");
  assert.equal(p.running, false);
  assert.equal(p.finished, 2);
  assert.equal(p.current, "");
});

test("batchBusyLine matches the collection toast copy", () => {
  assert.equal(batchBusyLine({ finished: 12, total: 607 }), "Downloading 12 of 607");
});

test("batchFolder strips path and reserved characters", () => {
  assert.equal(batchFolder("Pirate Game"), "Pirate Game");
  assert.equal(batchFolder('a/b\\c:d*"e"?<f>|'), "a b c d e f");
  assert.equal(batchFolder("..hidden.."), "hidden");
  assert.equal(batchFolder("  "), "Sketchfab collection");
  assert.equal(batchFolder("x".repeat(200)).length, 80);
});
