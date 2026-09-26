/**
 * Shared CRC-32 (IEEE 802.3, polynomial 0xedb88320).
 * Offset-capable: hash u8[start .. start+len). Returns an unsigned 32-bit value.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(u8, start, len) {
  let c = 0xffffffff;
  const end = start + len;
  for (let i = start; i < end; i++) {
    c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
