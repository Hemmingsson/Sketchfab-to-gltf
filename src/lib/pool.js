/**
 * Map `items` through `fn` with at most `limit` calls in flight. Results keep input order.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, idx: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}
