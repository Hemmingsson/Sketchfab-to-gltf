/**
 * Send a message until the receiver acks it with `{ ok: true }`.
 *
 * Orion (WebKit) can resolve `offscreen.createDocument` before the document's
 * listener is registered. The run message is then lost, or answered by the
 * popup with `undefined`, and the job sits in Queued. Resending until the
 * offscreen document acks closes that gap; Chrome acks on the first try.
 *
 * @param {() => Promise<unknown>} send
 * @param {{ attempts?: number, delayMs?: number, attemptMs?: number, wait?: (ms: number) => Promise<void> }} [opts]
 */
export async function sendUntilAcked(send, opts = {}) {
  const attempts = opts.attempts ?? 40;
  const delayMs = opts.delayMs ?? 250;
  const attemptMs = opts.attemptMs ?? 2000;
  const wait = opts.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError = "";
  for (let i = 0; i < attempts; i++) {
    try {
      const reply = await withTimeout(send(), attemptMs, "Reply");
      if (reply && typeof reply === "object" && /** @type {any} */ (reply).ok === true) return;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (i < attempts - 1) await wait(delayMs);
  }
  throw new Error(`Converter did not start${lastError ? ` (${lastError})` : ""}`);
}

/**
 * Reject with "`step` timed out" if `promise` has not settled after `ms`.
 * Browser APIs that Orion stubs can stay pending forever; a named timeout
 * turns that silent hang into an error the job log shows.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} step
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, step) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${step} timed out after ${Math.round(ms / 1000)} s`)), ms);
  });
  return /** @type {Promise<T>} */ (Promise.race([promise, timeout])).finally(() => clearTimeout(timer));
}
