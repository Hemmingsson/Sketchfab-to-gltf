import { test } from "node:test";
import assert from "node:assert/strict";
import { sendUntilAcked, withTimeout } from "../src/lib/handoff.js";

const noWait = () => Promise.resolve();

test("resolves on the first acked reply", async () => {
  let calls = 0;
  await sendUntilAcked(async () => (calls++, { ok: true }), { wait: noWait });
  assert.equal(calls, 1);
});

test("resends while the receiver is not listening yet", async () => {
  // Orion: the popup answers undefined, or nobody is listening and send throws.
  const replies = [undefined, "throw", { ok: true }];
  let calls = 0;
  await sendUntilAcked(
    async () => {
      const r = replies[calls++];
      if (r === "throw") throw new Error("Receiving end does not exist");
      return r;
    },
    { wait: noWait },
  );
  assert.equal(calls, 3);
});

test("rejects after the last attempt without an ack", async () => {
  let calls = 0;
  await assert.rejects(
    sendUntilAcked(async () => (calls++, undefined), { attempts: 4, wait: noWait }),
    /did not start/,
  );
  assert.equal(calls, 4);
});

test("waits between attempts, not after the last", async () => {
  const waits = [];
  await assert.rejects(
    sendUntilAcked(async () => undefined, {
      attempts: 3,
      delayMs: 250,
      wait: (ms) => (waits.push(ms), Promise.resolve()),
    }),
  );
  assert.deepEqual(waits, [250, 250]);
});

test("an attempt whose reply never arrives counts as no ack", async () => {
  // Orion: sendMessage can stay pending forever when nobody answers.
  let calls = 0;
  await sendUntilAcked(
    () => (calls++ === 0 ? new Promise(() => {}) : Promise.resolve({ ok: true })),
    { wait: noWait, attemptMs: 5 },
  );
  assert.equal(calls, 2);
});

test("withTimeout rejects with the step name when the promise hangs", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 5, "Opening converter"), /Opening converter timed out/);
  assert.equal(await withTimeout(Promise.resolve(7), 5, "x"), 7);
});
