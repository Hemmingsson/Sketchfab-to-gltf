/**
 * Shared gzip decompress for browser (DecompressionStream) and Node (zlib).
 * @param {Uint8Array | ArrayBuffer} bytes
 * @returns {Promise<Uint8Array>}
 */
export async function gunzipBytes(bytes) {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof DecompressionStream === "function") {
    const stream = new Blob([src]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const zlib = await import("node:zlib");
  return new Uint8Array(zlib.gunzipSync(src));
}
