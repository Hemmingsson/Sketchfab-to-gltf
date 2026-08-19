import { decodePngRgba, encodePngRgba } from './descramble.js';
import { isPackedOrmName } from './orm.js';

// --- Browser helpers (Uint8Array instead of Node Buffer) ---
function concatBytes(chunks) {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
function pad4(bytes, fill = 0) {
  const n = Math.ceil(bytes.length / 4) * 4;
  if (n === bytes.length) return bytes;
  const out = new Uint8Array(n);
  out.fill(fill);
  out.set(bytes);
  return out;
}
function u32le(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}
function typedToBytes(buf) {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

// --- Scene-graph matrix math (osg.MatrixTransform placement) ---
// OSG/glTF matrices are flat 16-element column-major arrays: translation at
// indices 12,13,14. Returns a ∘ b (child b applied first, then parent a).
// Null-safe: a null operand is treated as identity.
export function mat4Multiply(a, b) {
  if (!a) return b;
  if (!b) return a;
  const out = new Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

// OSG / viewer is Z-up. Official Sketchfab glTF is Y-up: (x, y, z) → (x, z, -y)
// == rotate −90° about X. Node matrices are conjugated so local Y-up verts
// compose to the same world as the old bake-then-flip path: M' = R M R⁻¹.
export const YUP_FROM_ZUP = [
  1, 0, 0, 0,
  0, 0, -1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
];
export const ZUP_FROM_YUP = [
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, -1, 0, 0,
  0, 0, 0, 1,
];

export function conjugateZupToYup(m) {
  if (!m) return m;
  return mat4Multiply(YUP_FROM_ZUP, mat4Multiply(m, ZUP_FROM_YUP));
}

function isApproxMat4(a, b, eps = 1e-3) {
    if (!a || !b || a.length !== 16) return false;
    for (let i = 0; i < 16; i++) {
        if (Math.abs(a[i] - b[i]) > eps) return false;
    }
    return true;
}

export function isIdentityMat4(m, eps = 1e-8) {
  if (!m) return true;
  for (let i = 0; i < 16; i++) {
    const ident = i % 5 === 0 ? 1 : 0;
    if (Math.abs(m[i] - ident) > eps) return false;
  }
  return true;
}

function vec3Norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

function vec3Cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function mat3ColsToQuat(x, y, z) {
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  let qx, qy, qz, qw;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    qw = 0.25 * s;
    qx = (m21 - m12) / s;
    qy = (m02 - m20) / s;
    qz = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }
  return [qx, qy, qz, qw];
}

/** glTF camera/light looks down −Z. Returns [x,y,z,w] looking from eye to target. */
export function lookAtRotation(eye, target, up = [0, 1, 0]) {
  const z = vec3Norm([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  let x = vec3Cross(up, z);
  if (Math.hypot(x[0], x[1], x[2]) < 1e-8) x = vec3Cross([1, 0, 0], z);
  x = vec3Norm(x);
  const y = vec3Cross(z, x);
  return mat3ColsToQuat(x, y, z);
}

/** Translation + rotation from a column-major mat4 (Sketchfab light matrix). */
export function mat4TranslationRotation(m) {
  if (!m || m.length !== 16) return { translation: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const sx = Math.hypot(m[0], m[1], m[2]) || 1;
  const sy = Math.hypot(m[4], m[5], m[6]) || 1;
  const sz = Math.hypot(m[8], m[9], m[10]) || 1;
  const x = [m[0] / sx, m[1] / sx, m[2] / sx];
  const y = [m[4] / sy, m[5] / sy, m[6] / sy];
  const z = [m[8] / sz, m[9] / sz, m[10] / sz];
  return {
    translation: [m[12], m[13], m[14]],
    rotation: mat3ColsToQuat(x, y, z),
  };
}

// Inverse-transpose of the upper-left 3x3 of a column-major mat4, as a 9-element
// column-major mat3, or null when the determinant is 0. Ported verbatim from
// gl-matrix's normalFromMat4 (MIT). Used to transform normals under non-uniform
// scale without skew.
export function normalFromMat4(a) {
  const a00=a[0],a01=a[1],a02=a[2],a03=a[3], a10=a[4],a11=a[5],a12=a[6],a13=a[7],
        a20=a[8],a21=a[9],a22=a[10],a23=a[11], a30=a[12],a31=a[13],a32=a[14],a33=a[15];
  const b00=a00*a11-a01*a10, b01=a00*a12-a02*a10, b02=a00*a13-a03*a10,
        b03=a01*a12-a02*a11, b04=a01*a13-a03*a11, b05=a02*a13-a03*a12,
        b06=a20*a31-a21*a30, b07=a20*a32-a22*a30, b08=a20*a33-a23*a30,
        b09=a21*a32-a22*a31, b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
  let det=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
  if(!det) return null;
  det=1.0/det;
  const out=new Array(9);
  out[0]=(a11*b11-a12*b10+a13*b09)*det; out[1]=(a12*b08-a10*b11-a13*b07)*det; out[2]=(a10*b10-a11*b08+a13*b06)*det;
  out[3]=(a02*b10-a01*b11-a03*b09)*det; out[4]=(a00*b11-a02*b08+a03*b07)*det; out[5]=(a01*b08-a00*b10-a03*b06)*det;
  out[6]=(a31*b05-a32*b04+a33*b03)*det; out[7]=(a32*b02-a30*b05-a33*b01)*det; out[8]=(a30*b04-a31*b02+a33*b00)*det;
  return out;
}

// Determinant of the upper-left 3x3 of a column-major mat4. A negative value
// means the matrix mirrors, so triangle winding must be reversed after baking.
export function det3(m){
  return m[0]*(m[5]*m[10]-m[6]*m[9]) - m[4]*(m[1]*m[10]-m[2]*m[9]) + m[8]*(m[1]*m[6]-m[2]*m[5]);
}

// Bake a column-major world matrix into a geometry's POSITION (affine),
// NORMAL (inverse-transpose 3x3), and TANGENT (upper 3x3, w preserved), then
// reverse winding when the matrix mirrors. Mutates result in place. Ported from
// glTF-Transform's transformPrimitive (MIT). No-op when m is null/identity so
// already-baked models stay byte-identical.
export function applyMatrixToVertices(result, m) {
  if (!m) return;
  const pos = result.attributes.POSITION;
  if (pos && pos.data && (pos.itemSize || 0) >= 3) {
    const d = pos.data, s = pos.itemSize;
    for (let i = 0; i < d.length; i += s) {
      const x = d[i], y = d[i + 1], z = d[i + 2];
      d[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
      d[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      d[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
  }
  // NORMAL: inverse-transpose 3x3 (transformMat3 convention), renormalized.
  const nrm = result.attributes.NORMAL;
  if (nrm && nrm.data && (nrm.itemSize || 0) >= 3) {
    const nm = normalFromMat4(m);
    if (nm) {
      const d = nrm.data, s = nrm.itemSize;
      for (let i = 0; i < d.length; i += s) {
        const x = d[i], y = d[i + 1], z = d[i + 2];
        let nx = x * nm[0] + y * nm[3] + z * nm[6];
        let ny = x * nm[1] + y * nm[4] + z * nm[7];
        let nz = x * nm[2] + y * nm[5] + z * nm[8];
        const len = Math.hypot(nx, ny, nz);
        if (len > 0) { nx /= len; ny /= len; nz /= len; }
        d[i] = nx; d[i + 1] = ny; d[i + 2] = nz;
      }
    }
    // nm === null (degenerate matrix): leave NORMAL untouched (no NaN).
  }
  // TANGENT (vec4): transform xyz by the upper 3x3 of m, renormalize, keep w.
  const tan = result.attributes.TANGENT;
  if (tan && tan.data && (tan.itemSize || 0) === 4) {
    const d = tan.data, s = tan.itemSize;
    for (let i = 0; i < d.length; i += s) {
      const x = d[i], y = d[i + 1], z = d[i + 2];
      let tx = x * m[0] + y * m[4] + z * m[8];
      let ty = x * m[1] + y * m[5] + z * m[9];
      let tz = x * m[2] + y * m[6] + z * m[10];
      const len = Math.hypot(tx, ty, tz);
      if (len > 0) { tx /= len; ty /= len; tz /= len; }
      d[i] = tx; d[i + 1] = ty; d[i + 2] = tz; // w (i+3) unchanged
    }
  }
  // Mirror (negative determinant) reverses triangle winding — same as
  // glTF-Transform's reversePrimitiveWindingOrder. Mode is always TRIANGLES here.
  if (result.indices && det3(m) < 0) {
    const idx = result.indices;
    for (let i = 0; i + 2 < idx.length; i += 3) {
      const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t;
    }
  }
}

// --- Sketchfab binary decoders (extracted from viewer JS) ---

function decodeVarint(bytes, count, typeName) {
    const signed = typeName[0] !== 'U';
    const result = signed ? new Int32Array(count) : new Uint32Array(count);
    let a = 0, o = 0;
    while (a < count) {
        let s = 0, l = 0;
        do { s |= (bytes[o] & 127) << l; l += 7; } while ((bytes[o++] & 128) !== 0);
        result[a++] = s;
    }
    if (signed) {
        for (let u = 0; u < count; u++) {
            const c = result[u];
            result[u] = (c >> 1) ^ -(c & 1); // zigzag decode
        }
    }
    return result;
}

function deltaDecodeInPlace(arr, startIdx) {
    const start = startIdx || 0;
    let prev = arr[start];
    for (let i = start + 1; i < arr.length; i++) {
        const v = arr[i];
        prev = arr[i] = prev + (v >> 1 ^ -(v & 1));
    }
    return arr;
}

function dequantize(encoded, output, bbl, h, itemSize) {
    const count = encoded.length / itemSize;
    for (let i = 0; i < count; i++) {
        const base = i * itemSize;
        for (let j = 0; j < itemSize; j++) {
            output[base + j] = bbl[j] + encoded[base + j] * h[j];
        }
    }
    return output;
}

const ANIM_BIN_GZ_RE = /\.bin\.gz$/i;
const QR_ZUP_TO_YUP = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
const QR_ZUP_TO_YUP_INV = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];

export function collectAnimationBinGzNames(osgjs) {
    const root = typeof osgjs === 'string' ? JSON.parse(osgjs) : osgjs;
    const names = new Set();
    const walk = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (typeof obj.File === 'string' && ANIM_BIN_GZ_RE.test(obj.File)) {
            names.add(obj.File);
        }
        if (Array.isArray(obj)) {
            for (const item of obj) walk(item);
            return;
        }
        for (const v of Object.values(obj)) walk(v);
    };
    walk(root);
    return [...names];
}

export function animationBinUrl(osgjsUrl, filename) {
    const s = String(osgjsUrl || '');
    const q = s.search(/[?#]/);
    const base = q >= 0 ? s.slice(0, q) : s;
    const suffix = q >= 0 ? s.slice(q) : '';
    const name = String(filename || '').replace(/^.*\//, '');
    // Viewer loads clips from …/<version>/animations/<hash>.bin.gz, not next
    // to file.binz under …/files/<id>/. That sibling path is 403 on the CDN.
    const filesDir = base.match(/^(.*)\/files\/[^/]+\/file\.binz$/i);
    if (filesDir) return `${filesDir[1]}/animations/${name}${suffix}`;
    if (/file\.binz$/i.test(base)) return base.replace(/file\.binz$/i, name) + suffix;
    return s.replace(/file\.binz.*$/, name);
}

export async function gunzipBytes(bytes) {
    const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (typeof DecompressionStream === 'function') {
        const stream = new Blob([src]).stream().pipeThrough(new DecompressionStream('gzip'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const zlib = await import('node:zlib');
    return new Uint8Array(zlib.gunzipSync(src));
}

export function readOsgBufferArray(binSrc, spec, typeName) {
    return readBufferArray(asArrayBuffer(binSrc), spec, typeName);
}

function userDataMap(container) {
    const meta = Object.create(null);
    const values = container && container.Values;
    if (!values) return meta;
    for (const v of values) {
        if (!v || v.Name == null) continue;
        const num = Number(v.Value);
        meta[v.Name] = Number.isNaN(num) ? v.Value : num;
    }
    return meta;
}

// Sketchfab osgAnimation channel_mode bits (viewer I() decoder).
export const ANIM_CHANNEL_MODE = {
    BBOX: 1,        // P: vec3 bbox dequant (bbl + q*h)
    ORIGIN_KEY: 4,  // N: prepend origin, then prefix-sum / quat product
    QUAT_OCT: 8,    // O: packed quat via decodeNormals
    TIME_DELTA: 16, // D: prepend ot, then prefix-sum times
};

/** Planar xxx…yyy…zzz → interleaved xyzxyz (Sketchfab helper m). */
export function deinterleavePlanar(src, itemSize) {
    const n = src.length / itemSize;
    const out = new Float32Array(src.length);
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < itemSize; j++) {
            out[i * itemSize + j] = src[i + n * j];
        }
    }
    return out;
}

/** In-place prefix-sum per component (Sketchfab helper p). */
export function prefixSum(arr, itemSize = 1) {
    const n = arr.length / itemSize;
    for (let i = 1; i < n; i++) {
        const prev = (i - 1) * itemSize;
        const cur = i * itemSize;
        for (let j = 0; j < itemSize; j++) arr[cur + j] += arr[prev + j];
    }
    return arr;
}

/** In-place key[i] = key[i-1] * key[i] (Sketchfab helper v). */
export function prefixQuatMultiply(arr) {
    const n = arr.length / 4;
    for (let i = 1; i < n; i++) {
        const p = (i - 1) * 4;
        const c = i * 4;
        const q = quatMultiply(
            [arr[p], arr[p + 1], arr[p + 2], arr[p + 3]],
            [arr[c], arr[c + 1], arr[c + 2], arr[c + 3]],
        );
        arr[c] = q[0];
        arr[c + 1] = q[1];
        arr[c + 2] = q[2];
        arr[c + 3] = q[3];
    }
    return arr;
}

// Packed Vec3 keys: origin + bbox-min + quantized*step (same idea as POSITION bbl+q*h).
export function dequantizePackedVec3(encoded, userData) {
    const ox = userData.ox || 0, oy = userData.oy || 0, oz = userData.oz || 0;
    const bx = userData.bx || 0, by = userData.by || 0, bz = userData.bz || 0;
    const hx = userData.hx || 0, hy = userData.hy || 0, hz = userData.hz || 0;
    const out = new Float32Array(encoded.length);
    for (let i = 0; i + 2 < encoded.length; i += 3) {
        out[i] = ox + bx + encoded[i] * hx;
        out[i + 1] = oy + by + encoded[i + 1] * hy;
        out[i + 2] = oz + bz + encoded[i + 2] * hz;
    }
    return out;
}

/** Official packed vec3: deinterleave, bbox (no origin), optional prepend+prefix-sum. */
export function decodePackedVec3(encoded, userData) {
    const mode = Number(userData.channel_mode) || 0;
    const planar = encoded.length >= 3 ? deinterleavePlanar(encoded, 3) : Float32Array.from(encoded);
    const bx = userData.bx || 0, by = userData.by || 0, bz = userData.bz || 0;
    const hx = userData.hx || 0, hy = userData.hy || 0, hz = userData.hz || 0;
    const deltas = new Float32Array(planar.length);
    if (mode & ANIM_CHANNEL_MODE.BBOX) {
        for (let i = 0; i + 2 < planar.length; i += 3) {
            deltas[i] = bx + planar[i] * hx;
            deltas[i + 1] = by + planar[i + 1] * hy;
            deltas[i + 2] = bz + planar[i + 2] * hz;
        }
    } else {
        deltas.set(planar);
    }
    if (mode & ANIM_CHANNEL_MODE.ORIGIN_KEY) {
        const full = new Float32Array(deltas.length + 3);
        full[0] = userData.ox || 0;
        full[1] = userData.oy || 0;
        full[2] = userData.oz || 0;
        full.set(deltas, 3);
        return prefixSum(full, 3);
    }
    if (!mode) return dequantizePackedVec3(encoded, userData);
    return deltas;
}

function quatMultiply(a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
}

function normalizeQuat(q) {
    const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Rotation that takes unit vector `a` to unit vector `b`. +Z → +Z is identity. */
function quatFromTo(a, b) {
    const c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (c > 0.999999) return [0, 0, 0, 1];
    if (c < -0.999999) return [1, 0, 0, 0];
    return normalizeQuat([
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
        1 + c,
    ]);
}

/** Packed times are sometimes deltas (unsorted / tiny max) and sometimes absolute. */
export function timesLookLikeDeltas(times) {
    if (!times || times.length < 2) return false;
    for (let i = 1; i < times.length; i++) {
        if (times[i] < times[i - 1]) return true;
    }
    const first = times[0];
    const last = times[times.length - 1];
    if (first <= 1e-6 && last > 1) return false;
    return times.length >= 8 && last <= 1;
}

/** Packed CompressedPacked times are deltas from `ot`, not absolute timestamps. */
export function accumulateDeltaTimes(deltas, ot = 0) {
    const out = new Float32Array(deltas.length);
    let t = Number(ot) || 0;
    for (let i = 0; i < deltas.length; i++) {
        t += deltas[i];
        out[i] = t;
    }
    return out;
}

/** glTF sampler input must be strictly increasing. Keep the last value on a tie. */
export function collapseNonIncreasing(times, values, itemSize) {
    if (!times.length) return { times, values };
    const tOut = [];
    const vOut = [];
    for (let i = 0; i < times.length; i++) {
        if (tOut.length && times[i] <= tOut[tOut.length - 1]) {
            const base = (tOut.length - 1) * itemSize;
            for (let j = 0; j < itemSize; j++) vOut[base + j] = values[i * itemSize + j];
            continue;
        }
        tOut.push(times[i]);
        for (let j = 0; j < itemSize; j++) vOut.push(values[i * itemSize + j]);
    }
    return { times: Float32Array.from(tOut), values: Float32Array.from(vOut) };
}

function prependRestKey(times, values, rest, itemSize) {
    if (!times.length || times[0] <= 0) return { times, values };
    const t = new Float32Array(times.length + 1);
    t[0] = 0;
    t.set(times, 1);
    const v = new Float32Array(values.length + itemSize);
    v.set(rest, 0);
    v.set(values, itemSize);
    return { times: t, values: v };
}

export function remapTranslationYup(x, y, z) {
    return [x, z, -y];
}

export function remapScaleYup(sx, sy, sz) {
    return [sx, sz, sy];
}

export function remapRotationYup(q) {
    return quatMultiply(QR_ZUP_TO_YUP, quatMultiply(q, QR_ZUP_TO_YUP_INV));
}

export function decodePackedQuat(encoded, userData) {
    const mode = Number(userData.channel_mode) || 0;
    const planar = deinterleavePlanar(encoded, 3);
    const count = Math.floor(planar.length / 3);
    const local = new Float32Array(count * 4);
    decodeNormals(planar, local, 4, userData.epsilon, userData.nphi, true);
    if (mode & ANIM_CHANNEL_MODE.ORIGIN_KEY) {
        const full = new Float32Array((count + 1) * 4);
        full[0] = userData.ox || 0;
        full[1] = userData.oy || 0;
        full[2] = userData.oz || 0;
        full[3] = userData.ow != null ? userData.ow : 1;
        full.set(local, 4);
        return prefixQuatMultiply(full);
    }
    return local;
}

function lookupAnimBin(fileMap, fileName) {
    if (!fileMap || !fileName) return null;
    return fileMap[fileName] || fileMap[fileName.replace(/\.gz$/i, '')] || null;
}

function readAnimArray(arr, fileMap) {
    if (!arr || !arr.Array) return { missing: true };
    const typeName = Object.keys(arr.Array)[0];
    const def = arr.Array[typeName];
    if (!def) return { missing: true };
    const binSrc = lookupAnimBin(fileMap, def.File);
    if (!binSrc) return { missing: true, file: def.File };
    const itemSize = arr.ItemSize || 1;
    const data = readBufferArray(asArrayBuffer(binSrc), { ...def, ItemSize: itemSize }, typeName);
    return { data, itemSize, size: def.Size, typeName, encoding: def.Encoding, file: def.File };
}

const OSG_CHANNEL_KEYS = {
    'osgAnimation.Vec3LerpChannel': { kind: 'vec3', packed: false },
    'osgAnimation.Vec3LerpChannelCompressedPacked': { kind: 'vec3', packed: true },
    'osgAnimation.QuatSlerpChannel': { kind: 'quat', packed: false },
    'osgAnimation.QuatSlerpChannelCompressedPacked': { kind: 'quat', packed: true },
    'osgAnimation.FloatLerpChannel': { kind: 'float', packed: false },
};

function unwrapOsgChannel(wrapper) {
    if (!wrapper || typeof wrapper !== 'object') return null;
    for (const [key, spec] of Object.entries(OSG_CHANNEL_KEYS)) {
        if (wrapper[key]) return { payload: wrapper[key], ...spec };
    }
    return null;
}

export function summarizeOsgAnimations(osgjs) {
    let root = osgjs;
    if (typeof root === 'string') {
        try {
            root = JSON.parse(root);
        } catch (_) {
            return [];
        }
    }
    return collectOsgAnimations(root).map((clip) => ({
        name: clip.Name || '',
        channels: (clip.Channels || []).map((wrap) => {
            const ch = unwrapOsgChannel(wrap);
            if (!ch) {
                return { type: Object.keys(wrap || {})[0] || 'unknown' };
            }
            const kf = ch.payload.KeyFrames || {};
            const timeFile = kf.Time && kf.Time.Array && kf.Time.Array[Object.keys(kf.Time.Array)[0]];
            const keyFile = kf.Key && kf.Key.Array && kf.Key.Array[Object.keys(kf.Key.Array)[0]];
            return {
                type: ch.kind + (ch.packed ? '-packed' : ''),
                target: ch.payload.TargetName || '',
                name: ch.payload.Name || '',
                timeFile: timeFile && timeFile.File,
                keyFile: keyFile && keyFile.File,
            };
        }),
    }));
}

function collectOsgAnimations(node) {
    const clips = [];
    const walk = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
            for (const item of obj) walk(item);
            return;
        }
        const mgr = obj['osgAnimation.BasicAnimationManager'];
        if (mgr && Array.isArray(mgr.Animations)) {
            for (const wrap of mgr.Animations) {
                const clip = wrap && (wrap['osgAnimation.Animation'] || wrap);
                if (clip && Array.isArray(clip.Channels)) clips.push(clip);
            }
        }
        for (const v of Object.values(obj)) walk(v);
    };
    walk(node);
    return clips;
}

function decodeAnimChannel(chInfo, fileMap) {
    const kf = chInfo.payload.KeyFrames;
    if (!kf) return null;
    const timeArr = readAnimArray(kf.Time, fileMap);
    const keyArr = readAnimArray(kf.Key, fileMap);
    if (!timeArr || !timeArr.data || !keyArr || !keyArr.data) {
        return { missingBin: !!(timeArr && timeArr.missing) || !!(keyArr && keyArr.missing) };
    }
    let times = timeArr.data instanceof Float32Array
        ? timeArr.data
        : Float32Array.from(timeArr.data);
    const ud = userDataMap(chInfo.payload.UserDataContainer);
    const mode = Number(ud.channel_mode) || 0;
    let values;
    if (chInfo.kind === 'vec3' && chInfo.packed) {
        values = decodePackedVec3(keyArr.data, ud);
    } else if (chInfo.kind === 'quat' && chInfo.packed) {
        values = decodePackedQuat(keyArr.data, ud);
    } else if (keyArr.data instanceof Float32Array) {
        values = keyArr.data;
    } else {
        values = Float32Array.from(keyArr.data);
    }
    const itemSize = chInfo.kind === 'quat' ? 4 : chInfo.kind === 'vec3' ? 3 : 1;
    if (chInfo.packed && (mode & ANIM_CHANNEL_MODE.TIME_DELTA)) {
        const prefixed = new Float32Array(times.length + 1);
        prefixed[0] = Number(ud.ot) || 0;
        prefixed.set(times, 1);
        times = prefixSum(prefixed, 1);
    }
    const nKeys = Math.floor(values.length / itemSize);
    if (times.length !== nKeys) {
        const n = Math.min(times.length, nKeys);
        times = times.subarray(0, n);
        values = values.subarray(0, n * itemSize);
    }
    ({ times, values } = collapseNonIncreasing(times, values, itemSize));
    return {
        name: chInfo.payload.Name,
        targetName: chInfo.payload.TargetName,
        kind: chInfo.kind,
        packed: !!chInfo.packed,
        times,
        values,
    };
}

function gltfPathForChannel(decoded) {
    if (decoded.kind === 'float') return 'weights';
    const n = String(decoded.name || '').toLowerCase();
    if (n === 'translate' || n === 'translation') return 'translation';
    if (n === 'rotate' || n === 'rotation') return 'rotation';
    if (n === 'scale') return 'scale';
    return null;
}

function applyYupToChannel(decoded, path) {
    const v = decoded.values;
    if (path === 'translation') {
        for (let i = 0; i + 2 < v.length; i += 3) {
            const r = remapTranslationYup(v[i], v[i + 1], v[i + 2]);
            v[i] = r[0]; v[i + 1] = r[1]; v[i + 2] = r[2];
        }
    } else if (path === 'scale') {
        for (let i = 0; i + 2 < v.length; i += 3) {
            const r = remapScaleYup(v[i], v[i + 1], v[i + 2]);
            v[i] = r[0]; v[i + 1] = r[1]; v[i + 2] = r[2];
        }
    } else if (path === 'rotation') {
        for (let i = 0; i + 3 < v.length; i += 4) {
            const r = remapRotationYup([v[i], v[i + 1], v[i + 2], v[i + 3]]);
            const prev = i >= 4 ? [v[i - 4], v[i - 3], v[i - 2], v[i - 1]] : null;
            if (prev && prev[0] * r[0] + prev[1] * r[1] + prev[2] * r[2] + prev[3] * r[3] < 0) {
                r[0] = -r[0]; r[1] = -r[1]; r[2] = -r[2]; r[3] = -r[3];
            }
            v[i] = r[0]; v[i + 1] = r[1]; v[i + 2] = r[2]; v[i + 3] = r[3];
        }
    }
}

function sampleScalar(times, values, t) {
    if (!times.length) return 0;
    if (t <= times[0]) return values[0];
    if (t >= times[times.length - 1]) return values[values.length - 1];
    let i = 1;
    while (i < times.length && times[i] < t) i++;
    const t0 = times[i - 1], t1 = times[i];
    const u = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    return values[i - 1] * (1 - u) + values[i] * u;
}

function mergeWeightTracks(tracks, weightCount) {
    const stamp = [];
    for (const tr of tracks) {
        for (const t of tr.times) stamp.push(t);
    }
    stamp.sort((a, b) => a - b);
    const times = [];
    for (const t of stamp) {
        if (!times.length || t > times[times.length - 1]) times.push(t);
    }
    const values = new Float32Array(times.length * weightCount);
    for (let i = 0; i < times.length; i++) {
        for (let w = 0; w < weightCount; w++) {
            const tr = tracks.find((c) => c.index === w);
            values[i * weightCount + w] = tr ? sampleScalar(tr.times, tr.values, times[i]) : 0;
        }
    }
    return { times: Float32Array.from(times), values };
}

function findNodeByName(gltf, name) {
    if (!name) return -1;
    for (let i = 0; i < gltf.nodes.length; i++) {
        const n = gltf.nodes[i];
        if (n.name === name) return i;
        const aliases = n.extras && n.extras.osgUpdateNames;
        if (Array.isArray(aliases) && aliases.includes(name)) return i;
    }
    return -1;
}

/** Animation TargetName is UpdateBone / UpdateMatrixTransform.Name, not Bone.Name. */
function collectUpdateAliases(payload) {
    const aliases = [];
    const cbs = payload && payload.UpdateCallbacks;
    if (!Array.isArray(cbs)) return aliases;
    for (const wrap of cbs) {
        if (!wrap || typeof wrap !== 'object') continue;
        const ub = wrap['osgAnimation.UpdateBone'] || wrap['osgAnimation.UpdateMatrixTransform'];
        if (ub && ub.Name) aliases.push(String(ub.Name));
    }
    return aliases;
}

function findMorphTargetNode(gltf, targetName) {
    for (let mi = 0; mi < (gltf.meshes || []).length; mi++) {
        const mesh = gltf.meshes[mi];
        const names = (mesh.extras && mesh.extras.targetNames) || [];
        if (names.includes(targetName) || mesh.name === targetName) {
            for (let ni = 0; ni < gltf.nodes.length; ni++) {
                if (gltf.nodes[ni].mesh === mi) {
                    return { nodeIdx: ni, weightCount: (mesh.weights && mesh.weights.length) || names.length || 1 };
                }
            }
        }
    }
    const named = findNodeByName(gltf, targetName);
    if (named >= 0 && gltf.nodes[named].mesh !== undefined) {
        const mesh = gltf.meshes[gltf.nodes[named].mesh];
        if (mesh && mesh.weights) {
            return { nodeIdx: named, weightCount: mesh.weights.length };
        }
    }
    return null;
}

function decomposeMat4ToTRS(m) {
    const translation = [m[12], m[13], m[14]];
    let sx = Math.hypot(m[0], m[1], m[2]);
    let sy = Math.hypot(m[4], m[5], m[6]);
    let sz = Math.hypot(m[8], m[9], m[10]);
    if (sx < 1e-12) sx = 1;
    if (sy < 1e-12) sy = 1;
    if (sz < 1e-12) sz = 1;
    if (det3(m) < 0) sx = -sx;
    const r00 = m[0] / sx, r10 = m[1] / sx, r20 = m[2] / sx;
    const r01 = m[4] / sy, r11 = m[5] / sy, r21 = m[6] / sy;
    const r02 = m[8] / sz, r12 = m[9] / sz, r22 = m[10] / sz;
    const trace = r00 + r11 + r22;
    let rotation;
    if (trace > 0) {
        const s = 0.5 / Math.sqrt(trace + 1);
        rotation = [(r21 - r12) * s, (r02 - r20) * s, (r10 - r01) * s, 0.25 / s];
    } else if (r00 > r11 && r00 > r22) {
        const s = 2 * Math.sqrt(1 + r00 - r11 - r22);
        rotation = [0.25 * s, (r01 + r10) / s, (r02 + r20) / s, (r21 - r12) / s];
    } else if (r11 > r22) {
        const s = 2 * Math.sqrt(1 + r11 - r00 - r22);
        rotation = [(r01 + r10) / s, 0.25 * s, (r12 + r21) / s, (r02 - r20) / s];
    } else {
        const s = 2 * Math.sqrt(1 + r22 - r00 - r11);
        rotation = [(r02 + r20) / s, (r12 + r21) / s, 0.25 * s, (r10 - r01) / s];
    }
    return { translation, rotation, scale: [sx, sy, sz] };
}

function ensureNodeTrs(node) {
    if (!node.matrix) return;
    const trs = decomposeMat4ToTRS(node.matrix);
    delete node.matrix;
    node.translation = trs.translation;
    node.rotation = trs.rotation;
    node.scale = trs.scale;
}

function decodeNormals(encoded, output, itemSize, epsilon, nphi, hasThirdComponent) {
    epsilon = epsilon || 0.25;
    nphi = nphi || 720;
    const PI = 3.14159265359;
    const cosEps = Math.cos(0.01745329251 * epsilon);
    const dPhi = PI / (nphi - 1);
    const dGamma = 1.57079632679 / (nphi - 1);
    const stride = hasThirdComponent ? 3 : 2;
    const count = encoded.length / stride;

    for (let i = 0; i < count; i++) {
        const outIdx = i * itemSize;
        const inIdx = i * stride;
        let S = encoded[inIdx];
        let x = encoded[inIdx + 1];

        if (itemSize === 4 && !hasThirdComponent) {
            output[outIdx + 3] = (S & 1024) ? -1 : 1;
            S &= ~1024;
        }

        const A0 = S * dPhi;
        const R = Math.cos(A0);
        const w = Math.sin(A0);
        const A1 = A0 + dGamma;
        let E = (cosEps - R * Math.cos(A1)) / Math.max(1e-5, w * Math.sin(A1));
        if (E > 1) E = 1; else if (E < -1) E = -1;
        const P = 6.28318530718 * x / Math.ceil(PI / Math.max(1e-5, Math.acos(E)));

        output[outIdx] = w * Math.cos(P);
        output[outIdx + 1] = w * Math.sin(P);
        output[outIdx + 2] = R;
        if (hasThirdComponent) {
            // Third uint16 is an axis-angle (π/65535), not octahedral leftover.
            const theta = (Math.PI / 65535) * encoded[inIdx + 2];
            const sAng = Math.sin(theta);
            output[outIdx] *= sAng;
            output[outIdx + 1] *= sAng;
            output[outIdx + 2] *= sAng;
            if (itemSize >= 4) output[outIdx + 3] = Math.cos(theta);
        }
    }
    return output;
}

function implicitDecode(encoded, output, startIdx, useExpected) {
    let r = encoded[2]; // expectedIndex
    const maskLen = encoded[1];
    const headerLen = 3;
    const maskView = encoded.subarray(headerLen, maskLen + headerLen);
    const masks = new Uint32Array(maskView.buffer, maskView.byteOffset, maskLen);
    let idx = startIdx;
    const padBits = maskLen * 32 - output.length;

    for (let u = 0; u < maskLen; u++) {
        const c = masks[u];
        let h = u * 32; // output position (independent of d)
        const dStart = (u === maskLen - 1) ? padBits : 0;
        for (let d = dStart; d < 32; d++, h++) {
            if (h >= output.length) break;
            if (c & ((-2147483648) >>> d)) {
                output[h] = encoded[idx++];
            } else {
                output[h] = useExpected ? r : r++;
            }
        }
    }
    return output;
}

function expectedRenumber(arr, state) {
    let n = state[0];
    for (let a = 0; a < arr.length; a++) {
        const o = n - arr[a];
        arr[a] = o;
        if (n <= o) n = o + 1;
    }
    state[0] = n;
    return arr;
}

// Numeric sort of _TC_* keys by the integer suffix after _TC_, so _TC_2 precedes
// _TC_10 (lexicographic .sort() would order them wrong at 10+ UV sets).
export function sortTexCoordKeys(keys) {
    return keys.slice().sort((a, b) => {
        const na = parseInt(a.slice('_TC_'.length), 10);
        const nb = parseInt(b.slice('_TC_'.length), 10);
        return na - nb;
    });
}

// Index buffers narrower than 32-bit must be widened before delta/watermark
// decode, otherwise the arithmetic wraps (e.g. a Uint8 index buffer).
function widenIndices(arr) {
    if (arr instanceof Uint32Array || arr instanceof Int32Array) return arr;
    return Int32Array.from(arr);
}

function triStripToTriangles(indices) {
    if (indices.length < 3) return new Uint32Array(0);
    const tris = [];
    for (let i = 0; i < indices.length - 2; i++) {
        const a = indices[i], b = indices[i + 1], c = indices[i + 2];
        if (a === b || b === c || a === c) continue; // degenerate
        if (i % 2 === 0) {
            tris.push(a, b, c);
        } else {
            tris.push(b, a, c); // flip winding on odd
        }
    }
    return new Uint32Array(tris);
}

// Loose triangle list (already in triangle order): drop degenerate triangles
function looseTrianglesToTriangles(indices) {
    const tris = [];
    for (let i = 0; i + 2 < indices.length; i += 3) {
        const a = indices[i], b = indices[i + 1], c = indices[i + 2];
        if (a === b || b === c || a === c) continue; // degenerate
        tris.push(a, b, c);
    }
    return new Uint32Array(tris);
}

// Triangle fan → triangle list: (indices[0], indices[i], indices[i+1]).
// Mirrors Cesium's canonical fan-to-triangles formula.
export function triFanToTriangles(indices) {
    if (indices.length < 3) return new Uint32Array(0);
    const tris = [];
    for (let i = 1; i < indices.length - 1; i++) {
        const a = indices[0], b = indices[i], c = indices[i + 1];
        if (a === b || b === c || a === c) continue; // degenerate
        tris.push(a, b, c);
    }
    return new Uint32Array(tris);
}

// Quads → triangle list: per group of 4, (0,1,2) + (0,2,3).
// Mirrors Cesium's canonical quad-to-triangles formula.
export function quadsToTriangles(indices) {
    const tris = [];
    for (let i = 0; i + 3 < indices.length; i += 4) {
        const a = indices[i], b = indices[i + 1], c = indices[i + 2], d = indices[i + 3];
        tris.push(a, b, c);
        tris.push(a, c, d);
    }
    return new Uint32Array(tris);
}

// Sketchfab Color attrs are usually a constant engine tint (often pink +
// alpha≈0.5). Blender multiplies baseColorTexture * COLOR_0, so those must
// stay dropped. Keep only when RGB(A) actually varies per vertex.
const VERTEX_COLOR_RANGE_EPS = 2 / 255;

export function shouldKeepVertexColors(data, itemSize) {
    if (!data || (itemSize !== 3 && itemSize !== 4)) return false;
    const count = Math.floor(data.length / itemSize);
    if (count < 1) return false;

    let scale = 1;
    for (let i = 0; i < data.length; i++) {
        if (data[i] > 1.5) {
            scale = 1 / 255;
            break;
        }
    }

    const mins = [Infinity, Infinity, Infinity, Infinity];
    const maxs = [-Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
        const base = i * itemSize;
        for (let c = 0; c < itemSize; c++) {
            const v = data[base + c] * scale;
            if (v < mins[c]) mins[c] = v;
            if (v > maxs[c]) maxs[c] = v;
        }
    }
    for (let c = 0; c < itemSize; c++) {
        if (maxs[c] - mins[c] > VERTEX_COLOR_RANGE_EPS) return true;
    }
    return false;
}

function color0FromOsgAttr(data, itemSize, count) {
    if (itemSize !== 3 && itemSize !== 4) return null;
    let floats;
    if (data instanceof Float32Array) {
        floats = data;
    } else {
        const scale = data instanceof Uint8Array ? 1 / 255 : 1;
        floats = new Float32Array(data.length);
        for (let i = 0; i < data.length; i++) floats[i] = data[i] * scale;
    }
    if (!shouldKeepVertexColors(floats, itemSize)) return null;
    return { data: floats, itemSize, count };
}

// Parallelogram predictor: reconstructs vertex positions from residuals + strip topology
function parallelogramPredict(data, itemSize, stripIndices) {
    const vertCount = data.length / itemSize;
    const visited = new Uint8Array(vertCount);
    const numStrip = stripIndices.length - 1;

    visited[stripIndices[0]] = 1;
    visited[stripIndices[1]] = 1;
    visited[stripIndices[2]] = 1;

    for (let i = 2; i < numStrip; i++) {
        const a = stripIndices[i - 2];
        const b = stripIndices[i - 1];
        const c = stripIndices[i];
        const d = stripIndices[i + 1];

        if (visited[d] !== 1) {
            visited[d] = 1;
            const ai = a * itemSize;
            const bi = b * itemSize;
            const ci = c * itemSize;
            const di = d * itemSize;
            for (let j = 0; j < itemSize; j++) {
                // parallelogram: d = d_residual + b + c - a
                data[di + j] = data[di + j] + data[bi + j] + data[ci + j] - data[ai + j];
            }
        }
    }
    return data;
}

// --- osgjs parser ---

function asArrayBuffer(src) {
    if (!src) return null;
    if (src instanceof ArrayBuffer) return src;
    if (src.buffer instanceof ArrayBuffer) {
        // TypedArray or DataView or Node Buffer
        if (typeof src.byteOffset === 'number' && typeof src.byteLength === 'number'
            && !(src instanceof ArrayBuffer)) {
            return src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength);
        }
        return src.buffer;
    }
    if (src instanceof Uint8Array) return src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength);
    return src;
}

function readBufferArray(binData, vb, typeName) {
    const offset = vb.Offset || 0;
    const size = vb.Size;
    const itemSize = vb.ItemSize || 1;

    if (vb.Encoding === 'varint') {
        return decodeVarint(new Uint8Array(binData, offset), size * itemSize, typeName);
    }

    const types = {
        Float32Array: Float32Array, Int32Array: Int32Array,
        Uint32Array: Uint32Array, Uint16Array: Uint16Array,
        Uint8Array: Uint8Array, Int16Array: Int16Array
    };
    const TypedArr = types[typeName];
    if (!TypedArr) throw new Error(`Unknown type: ${typeName}`);
    const count = size * itemSize;
    // A typed-array view requires offset to be a multiple of the element size.
    // Some osgjs bins pack attributes at unaligned offsets; a view would throw
    // and the whole mesh would be dropped. Copy the bytes into an aligned
    // buffer in that case (same values, just not zero-copy).
    if (offset % TypedArr.BYTES_PER_ELEMENT !== 0) {
        const byteLen = count * TypedArr.BYTES_PER_ELEMENT;
        return new TypedArr(binData.slice(offset, offset + byteLen));
    }
    return new TypedArr(binData, offset, count);
}

function asUint16Vec4(data, itemSize, count) {
    const srcSize = itemSize || 4;
    const out = new Uint16Array(count * 4);
    for (let i = 0; i < count; i++) {
        for (let j = 0; j < 4 && j < srcSize; j++) {
            out[i * 4 + j] = data[i * srcSize + j];
        }
    }
    return out;
}

function normalizeWeightsVec4(data, itemSize, count) {
    const srcSize = itemSize || 4;
    const out = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        let sum = 0;
        for (let j = 0; j < 4 && j < srcSize; j++) {
            const w = data[i * srcSize + j] || 0;
            out[i * 4 + j] = w;
            sum += w;
        }
        if (sum > 1e-6 && Math.abs(sum - 1) > 1e-4) {
            for (let j = 0; j < 4; j++) out[i * 4 + j] /= sum;
        }
    }
    return out;
}

const IDENTITY_MAT4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function processGeometry(geom, polyBin, wireBin) {
    const result = { name: geom.Name || 'unnamed', attributes: {}, indices: null, mode: 'TRIANGLES', material: null };
    const meta = {};

    // Parse UserDataContainer
    const udc = geom.UserDataContainer;
    if (udc && udc.Values) {
        for (const v of udc.Values) {
            const val = v.Value;
            meta[v.Name] = isNaN(Number(val)) ? val : Number(val);
        }
    }

    // Process primitives
    const primList = geom.PrimitiveSetList || [];
    const DELTA = 1, EXPECTED = 2, IMPLICIT = 4, TRIANGLE_ATTR = 16;
    const triMode = meta.triangle_mode || 0;
    const hasTriAttr = (meta.attributes || 0) & TRIANGLE_ATTR;
    const triChunks = [];
    // The "expected"/high-watermark counter is shared across all of a geometry's
    // primitives and processed in list order: the strip advances it, then the
    // loose-triangle set continues from the same value. A fresh counter per
    // primitive corrupts the loose-triangle indices.
    const expState = [0];
    const SURFACE_MODES = new Set(['TRIANGLES', 'TRIANGLE_STRIP', 'TRIANGLE_FAN', 'QUADS']);
    // Convert a plain index list to a triangle list per primitive mode. Stores
    // strip indices for later parallelogram vertex prediction.
    const convertDirect = (mode, idx) => {
        if (mode === 'TRIANGLE_STRIP') { result.stripIndices = idx; return triStripToTriangles(idx); }
        if (mode === 'TRIANGLE_FAN') return triFanToTriangles(idx);
        if (mode === 'QUADS') return quadsToTriangles(idx);
        return looseTrianglesToTriangles(idx);
    };
    for (const prim of primList) {
        const drawType = Object.keys(prim)[0];
        const draw = prim[drawType];
        const idxInfo = draw.Indices;

        // Non-indexed DrawArrays: synthesize sequential indices [First .. First+Count-1]
        // for surface modes, then convert. POINTS/LINES stay skipped.
        if (!idxInfo) {
            if (SURFACE_MODES.has(draw.Mode) && draw.Count) {
                const first = draw.First || 0;
                const seq = new Int32Array(draw.Count);
                for (let i = 0; i < draw.Count; i++) seq[i] = first + i;
                triChunks.push(convertDirect(draw.Mode, seq));
            }
            continue;
        }
        if (!SURFACE_MODES.has(draw.Mode)) continue;

        const arrInfo = idxInfo.Array;
        const arrType = Object.keys(arrInfo)[0];
        const arrDef = arrInfo[arrType];
        const isWireframe = arrDef.File && arrDef.File.includes('wireframe');
        const binSrc = isWireframe ? wireBin : polyBin;
        if (!binSrc) continue;

        const isStrip = draw.Mode === 'TRIANGLE_STRIP';
        let indices = widenIndices(readBufferArray(asArrayBuffer(binSrc), { ...arrDef, ItemSize: 1 }, arrType));

        if (!hasTriAttr) {
            // Indices stored directly (not delta/watermark encoded).
            triChunks.push(convertDirect(draw.Mode, indices));
            continue;
        }

        // Compressed (delta/watermark) decode only supports TRIANGLES/STRIP.
        // FAN/QUADS are never compressed on Sketchfab; skip rather than mis-decode.
        if (draw.Mode === 'TRIANGLE_FAN' || draw.Mode === 'QUADS') {
            console.warn(`processGeometry: skipping compressed ${draw.Mode} (unsupported)`);
            continue;
        }

        let out = indices, startIdx = 0;
        if ((triMode & IMPLICIT) && isStrip) {
            startIdx = 3 + indices[1]; // IMPLICIT_HEADER_LENGTH + mask_length
            out = new Int32Array(indices[0]);
        }
        if (triMode & DELTA) deltaDecodeInPlace(indices, startIdx);
        if ((triMode & IMPLICIT) && isStrip) implicitDecode(indices, out, startIdx, !!(triMode & EXPECTED));
        if (triMode & EXPECTED) expectedRenumber(out, expState);

        if (isStrip) {
            result.stripIndices = out; // kept for parallelogram vertex prediction
            triChunks.push(triStripToTriangles(out));
        } else {
            triChunks.push(looseTrianglesToTriangles(out));
        }
    }

    let total = 0;
    for (const c of triChunks) total += c.length;
    if (total) {
        const merged = new Uint32Array(total);
        let o = 0;
        for (const c of triChunks) { merged.set(c, o); o += c.length; }
        result.indices = merged;
        result.mode = 'TRIANGLES';
    }

    // Process vertex attributes
    if (!result.indices) return result;
    const vaList = geom.VertexAttributeList || {};
    for (const [attrName, attrDef] of Object.entries(vaList)) {
        const arrInfo = attrDef.Array;
        const arrType = Object.keys(arrInfo)[0];
        const arrDef = arrInfo[arrType];
        const isWireframe = arrDef.File && arrDef.File.includes('wireframe');
        const binSrc = isWireframe ? wireBin : polyBin;
        if (!binSrc) continue;

        const itemSize = attrDef.ItemSize || 1;
        let data = readBufferArray(asArrayBuffer(binSrc), { ...arrDef, ItemSize: itemSize }, arrType);
        const count = arrDef.Size;
        const attrFlags = meta.attributes || 0;

        if (attrName === 'Vertex') {
            const vtxMode = meta.vertex_mode || 0;
            // Apply parallelogram prediction if flag set and strip indices available
            if ((vtxMode & 2) && result.stripIndices) {
                parallelogramPredict(data, itemSize, result.stripIndices);
            }
            // Dequantize if quantized
            if ((attrFlags & 1) || (vtxMode & 1)) {
                const prefix = 'vtx_';
                if (meta[prefix + 'bbl_x'] === undefined) {
                    // Some RigGeometry sources set the quantized bit on already-float
                    // Vertex arrays. Keep those. Integer verts without bbox still fail.
                    if (!(data instanceof Float32Array)) {
                        throw new Error('quantized POSITION without bbox meta');
                    }
                } else {
                    const bbl = [meta[prefix + 'bbl_x'], meta[prefix + 'bbl_y']];
                    const h = [meta[prefix + 'h_x'], meta[prefix + 'h_y']];
                    if (itemSize === 3) {
                        bbl.push(meta[prefix + 'bbl_z']);
                        h.push(meta[prefix + 'h_z']);
                    }
                    const floats = new Float32Array(data.length);
                    dequantize(data, floats, bbl, h, itemSize);
                    data = floats;
                }
            }
            result.attributes.POSITION = { data, itemSize, count };
        } else if (attrName === 'Normal') {
            if (attrFlags & 2) {
                const floats = new Float32Array(count * 3);
                decodeNormals(data, floats, 3, meta.epsilon, meta.nphi);
                result.attributes.NORMAL = { data: floats, itemSize: 3, count };
            } else {
                result.attributes.NORMAL = { data, itemSize, count };
            }
        } else if (attrName === 'Tangent') {
            if (attrFlags & 32) {
                const floats = new Float32Array(count * 4);
                decodeNormals(data, floats, 4, meta.epsilon, meta.nphi);
                result.attributes.TANGENT = { data: floats, itemSize: 4, count };
            }
        } else if (attrName.startsWith('TexCoord')) {
            const uvSuffix = attrName.replace('TexCoord', '');
            const prefix = `uv_${uvSuffix}_`;
            const uvMode = meta[`uv_${uvSuffix}_mode`] !== undefined ? meta[`uv_${uvSuffix}_mode`] : (meta.vertex_mode || 0);
            // Apply parallelogram prediction
            if ((uvMode & 2) && result.stripIndices) {
                parallelogramPredict(data, itemSize, result.stripIndices);
            }
            // Dequantize
            const uvQuantized = (attrFlags & 4) || (uvMode & 1);
            if (uvQuantized && meta[prefix + 'bbl_x'] === undefined) {
                // Missing bbox meta: storing raw ints would garble UVs. Drop this
                // UV set rather than emit garbage.
                console.warn(`processGeometry: dropping quantized UV set ${attrName} without bbox meta`);
                continue;
            }
            if (meta[prefix + 'bbl_x'] !== undefined && uvQuantized) {
                const bbl = [meta[prefix + 'bbl_x'], meta[prefix + 'bbl_y']];
                const h = [meta[prefix + 'h_x'], meta[prefix + 'h_y']];
                const floats = new Float32Array(data.length);
                dequantize(data, floats, bbl, h, itemSize);
                data = floats;
            } else if (!(data instanceof Float32Array)) {
                data = new Float32Array(data);
            }
            // Official Sketchfab glTF keeps OSG UVs as-is (UDIM U may sit in
            // [1,2]; V is not flipped). Sampler is REPEAT, same as official.
            // Drop all-zero UV channels (common empty lightmap slots)
            let anyNonZero = false;
            for (let i = 0; i < data.length; i++) {
                if (data[i] > 1e-6 && data[i] < 1 - 1e-6) { anyNonZero = true; break; }
                if (data[i] > 1e-6) { anyNonZero = true; break; }
            }
            // keep if any variation OR any value not exactly 0
            if (!anyNonZero) {
                let maxAbs = 0;
                for (let i = 0; i < data.length; i++) {
                    const a = Math.abs(data[i]);
                    if (a > maxAbs) maxAbs = a;
                }
                if (maxAbs < 1e-6) {
                    // truly empty — skip
                    continue;
                }
            }
            // Store with original osgjs name; will remap to continuous indices later
            result.attributes[`_TC_${uvSuffix}`] = { data, itemSize: itemSize || 2, count };
        } else if (attrName === 'Color') {
            const size = itemSize === 4 || itemSize === 3 ? itemSize : 0;
            if (!size) continue;
            const color0 = color0FromOsgAttr(data, size, count);
            if (color0) result.attributes.COLOR_0 = color0;
        } else if (attrName === 'Bones') {
            result.attributes.JOINTS_0 = {
                data: asUint16Vec4(data, itemSize, count),
                itemSize: 4,
                count,
                componentType: 5123,
            };
        } else if (attrName === 'Weights') {
            result.attributes.WEIGHTS_0 = {
                data: normalizeWeightsVec4(data, itemSize, count),
                itemSize: 4,
                count,
            };
        }
    }

    // Material + texture refs from StateSet
    const stateSet = geom.StateSet;
    if (stateSet && stateSet['osg.StateSet']) {
        const ss = stateSet['osg.StateSet'];
        // Maya/OBJ uploads often have no osg.Material — name is on the StateSet
        // (e.g. lambert2SG). Viewer materials use that same name.
        if (ss.Name) result.stateSetName = String(ss.Name);
        const attrList = ss.AttributeList || [];
        for (const attr of attrList) {
            if (attr['osg.Material']) {
                result.material = attr['osg.Material'];
                if (attr['osg.Material'].Name) {
                    result.materialName = String(attr['osg.Material'].Name);
                }
            }
        }
        if (!result.materialName && result.stateSetName) {
            result.materialName = result.stateSetName;
        }
        // TextureAttributeList: [[{ "osg.Texture": { File: "..." } }, states], ...]
        const texFiles = [];
        const tal = ss.TextureAttributeList || [];
        for (const unit of tal) {
            const entries = Array.isArray(unit) ? unit : [unit];
            for (const entry of entries) {
                if (!entry || typeof entry !== 'object') continue;
                const tex = entry['osg.Texture'] || entry['osg.Texture2D'];
                if (tex && tex.File) texFiles.push(String(tex.File));
            }
        }
        if (texFiles.length) result.textureFiles = texFiles;
    }
    // Fallback material name from geometry name: "...MI_1011801_10111_Body_0"
    if (!result.materialName && result.name) {
        const m = String(result.name).match(/MI_[A-Za-z0-9_]+/i);
        if (m) result.materialName = m[0].replace(/_\d+$/, '');
    }

    // Local mesh stays local. Official Sketchfab GLB remaps bind-pose
    // attributes (x, y, z) → (x, z, -y) and keeps bone TRS / IBMs in Z-up.
    for (const key of ['POSITION', 'NORMAL', 'TANGENT']) {
        const attr = result.attributes[key];
        if (!attr || !attr.data || (attr.itemSize || 0) < 3) continue;
        const d = attr.data;
        const s = attr.itemSize;
        for (let i = 0; i < d.length; i += s) {
            const y = d[i + 1];
            d[i + 1] = d[i + 2];
            d[i + 2] = -y;
        }
    }

    return result;
}

// --- Texture helpers ---

/** Basename of a texture path, strip optional "32hexuid_" prefix from download naming. */
export function textureBasename(filename) {
    let base = String(filename || '').split('/').pop();
    base = base.replace(/^[a-f0-9]{32}_/i, '');
    return base;
}

/**
 * Channel from Sketchfab-style suffixes: _D _N _ORM _E _AO _S _M _AN …
 * Prefer suffix over loose token matching (Body_N must be normal, not "body" albedo).
 */
export function classifyTextureName(filename) {
    const base = textureBasename(filename).toLowerCase();
    if (!base) return 'unknown';
    const stem = base.replace(/\.[^.]+$/, '');
    const packed = stem.replace(/[^a-z0-9]+/g, '');
    // Substrings first (Archer_NormalMap, Archer_SpecularMap — no _n / _s suffix)
    if (/normalmap|normal_map|bumpmap|bump_map/.test(packed) || /(?:^|_)(nrm|norm)(?:_|$)/.test(stem)) {
        return 'normal';
    }
    if (/specularmap|specmap|spec_map/.test(packed) || /(?:^|_)(spec|specular)(?:_|$)/.test(stem)) {
        return 'specular';
    }
    if (/metallicroughness|metalrough|mrao/.test(packed) || /(?:^|_)(orm)(?:_|$)/.test(stem)) {
        return 'metalrough';
    }
    if (/(?:^|_)(rough|roughness|metal|metallic)(?:_|$)/.test(stem)) return 'metalrough';
    if (/basecolor|base_color|albedo|diffuse/.test(packed)) return 'albedo';
    if (/emissive|emission/.test(packed) || /(?:^|_)(emit|glow)(?:_|$)/.test(stem)) return 'emissive';
    if (/ambientocclusion|occlusion/.test(packed) || /(?:^|_)(ao)(?:_|$)/.test(stem)) return 'occlusion';
    if (/lightmap/.test(packed) || /(?:^|_)(lm)(?:_|$)/.test(stem)) return 'lightmap';
    if (/opacity|alphamask|cutout|glowmask/.test(packed)) return 'alpha';

    // Strong Sketchfab/game suffixes
    if (/_(orm|mrao|metallicroughness|metalrough)$/i.test(stem)) return 'metalrough';
    if (/_(normal|nrm|norm)$/i.test(stem) || /_n$/i.test(stem)) return 'normal';
    if (/_(diffuse|albedo|basecolor|base_color|col)$/i.test(stem) || /_d$/i.test(stem)) return 'albedo';
    if (/_(emissive|emission|emit|glow)$/i.test(stem) || /_e$/i.test(stem)) return 'emissive';
    if (/_(ao|occlusion|ambientocclusion)$/i.test(stem) || /_ao$/i.test(stem)) return 'occlusion';
    if (/_(lightmap|lm)$/i.test(stem) || /lm_final/i.test(stem)) return 'lightmap';
    if (/_(opacity|alpha|mask|cutout|glowmask)$/i.test(stem) || /_(an|m)$/i.test(stem)) return 'alpha';
    if (/_s$/i.test(stem) || /_(spec|specular)$/i.test(stem)) return 'specular';

    const norm = `_${stem.replace(/[^a-z0-9]+/g, '_')}_`;
    const has = (...words) => words.some((w) => norm.includes(`_${w}_`));
    if (has('lightmap', 'lm')) return 'lightmap';
    if (has('ao', 'occlusion', 'cavity')) return 'occlusion';
    if (has('normal', 'nrm', 'norm')) return 'normal';
    if (has('metal', 'metallic', 'rough', 'roughness', 'orm', 'mrao')) return 'metalrough';
    if (has('emissive', 'emiss', 'emit', 'glow')) return 'emissive';
    if (has('albedo', 'diffuse', 'basecolor', 'atlas', 'diff')) return 'albedo';
    if (has('spec', 'specular')) return 'specular';
    return 'unknown';
}

/**
 * Resolve the PBR factors for a material, and whether its metal/rough texture
 * may be bound to metallicRoughnessTexture.
 *
 * glTF reads that texture as packed: green = roughness, blue = metalness.
 * Sketchfab's single-channel `*_metallic` map is therefore only safe to bind
 * after it has been packed with the matching roughness map — otherwise its
 * green channel drives roughness and non-metal surfaces render as mirrors.
 * Without a packed map the numeric factors from the viewer are authoritative,
 * including an explicit metallicFactor of 0.
 *
 * @param {object|null} map
 * @returns {{metallicFactor: number, roughnessFactor: number, bindTexture: boolean}}
 */
export function pbrFactors(map) {
    const metalF = map && typeof map.metallicFactor === 'number' ? map.metallicFactor : 0;
    const roughF = map && typeof map.roughnessFactor === 'number' ? map.roughnessFactor : 0.9;
    if (map && map.metalness && map.ormPacked) {
        // Factors multiply the texture, so 1.0 lets the map drive both channels.
        return { metallicFactor: 1, roughnessFactor: 1, bindTexture: true };
    }
    return { metallicFactor: metalF, roughnessFactor: roughF, bindTexture: false };
}

/**
 * Normalize material / texture identity for fuzzy matching.
 * Do NOT strip multi-digit suffixes like Equip_02 — only a single trailing
 * instance index (_0 … _9) used on mesh names.
 */
function identityKey(name) {
    let s = String(name || '');
    s = s.split('/').pop();
    s = s.replace(/^[a-f0-9]{32}_/i, '');
    s = s.replace(/\.[^.]+$/, '');
    s = s.replace(/^MI_/i, '').replace(/^T_/i, '').replace(/^TX_/i, '');
    // strip trailing channel tokens
    s = s.replace(/_(d|n|orm|mrao|e|ao|s|m|an|normal|diffuse|albedo|emissive|glowmask|mask|opacity)$/i, '');
    // mesh instance index only (…_0), keep …_01 / …_02 asset ids
    s = s.replace(/_(\d)$/, '');
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function mimeFromName(filename) {
    const base = String(filename || '').split('/').pop().toLowerCase();
    if (base.endsWith('.png')) return 'image/png';
    if (base.endsWith('.webp')) return 'image/webp';
    if (base.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
}

function findTextureBytes(filename, textureFiles) {
    if (!filename || !textureFiles) return null;
    if (textureFiles[filename]) return { data: textureFiles[filename], key: filename };
    const base = filename.split('/').pop();
    if (textureFiles[base]) return { data: textureFiles[base], key: base };
    const bare = textureBasename(filename);
    if (textureFiles[bare]) return { data: textureFiles[bare], key: bare };
    if (textureFiles['textures/' + bare]) {
        return { data: textureFiles['textures/' + bare], key: 'textures/' + bare };
    }
    // Match by texture UID embedded in path/name
    const uidM = String(filename).match(/([a-f0-9]{32})/i);
    if (uidM) {
        const uid = uidM[1].toLowerCase();
        for (const [k, v] of Object.entries(textureFiles)) {
            if (k.toLowerCase().includes(uid)) return { data: v, key: k };
        }
    }
    // Basename / identity key
    const stem = bare.replace(/\.[^.]+$/, '').toLowerCase();
    const id = identityKey(bare);
    for (const [k, v] of Object.entries(textureFiles)) {
        const kb = textureBasename(k).toLowerCase();
        if (kb === bare.toLowerCase() || kb === stem + '.png' || kb === stem + '.jpg') {
            return { data: v, key: k };
        }
        if (id && identityKey(kb) === id && classifyTextureName(kb) === classifyTextureName(bare)) {
            return { data: v, key: k };
        }
    }
    return null;
}

/**
 * Pick channel maps for a material/geometry name from the downloaded texture list.
 * Sketchfab rarely stores File paths in osgjs for modern models — only material names
 * like MI_…_Body, while downloads are T_…_Body_D.png / _N.png / _ORM.png.
 */
function mapTexturesForName(matName, geomName, textureList) {
    const list = textureList || [];
    if (!list.length) return null;

    const targets = [];
    if (matName) targets.push(identityKey(matName));
    if (geomName) {
        const g = String(geomName);
        const mi = g.match(/MI_[A-Za-z0-9_]+/i);
        if (mi) targets.push(identityKey(mi[0]));
        targets.push(identityKey(g));
    }
    const uniqTargets = [...new Set(targets.filter(Boolean))];

    // Score each texture against material identity
    const scored = list.map((t) => {
        const base = textureBasename(t.name);
        const tid = identityKey(base);
        let score = 0;
        for (const tgt of uniqTargets) {
            if (!tgt || !tid) continue;
            if (tid === tgt) score = Math.max(score, 100);
            else if (tid.endsWith(tgt) || tgt.endsWith(tid)) score = Math.max(score, 80);
            else if (tid.includes(tgt) || tgt.includes(tid)) score = Math.max(score, 60);
            else {
                // token overlap (Body, Head, Equip_01, …)
                const tt = new Set(tgt.split('_').filter((x) => x.length > 2 && !/^\d+$/.test(x)));
                const ti = tid.split('_').filter((x) => x.length > 2 && !/^\d+$/.test(x));
                let hit = 0;
                for (const x of ti) if (tt.has(x)) hit++;
                if (hit >= 2) score = Math.max(score, 40 + hit * 5);
                else if (hit === 1 && ti.length <= 3) score = Math.max(score, 25);
            }
        }
        return { base, cls: classifyTextureName(base), score, name: t.name };
    });

    const bestByClass = {};
    for (const s of scored) {
        // albedo can be a looser match; other channels need a stronger name match
        // so random *_E / *_N from another part don't attach to Body/Head.
        const need = s.cls === 'albedo' || s.cls === 'unknown' ? 25 : 55;
        if (s.score < need) continue;
        const prev = bestByClass[s.cls];
        if (!prev || s.score > prev.score) bestByClass[s.cls] = s;
    }

    // If nothing matched material name, leave empty (caller may use global)
    if (!Object.keys(bestByClass).length) return null;

    const map = {};
    if (bestByClass.albedo) map.albedo = bestByClass.albedo.base;
    if (bestByClass.normal) map.normal = bestByClass.normal.base;
    if (bestByClass.metalrough) map.metalness = bestByClass.metalrough.base;
    if (bestByClass.emissive) map.emissive = bestByClass.emissive.base;
    if (bestByClass.occlusion) map.occlusion = bestByClass.occlusion.base;
    // Only treat explicit opacity/cutout as alpha — NOT Hair_M / GlowMask
    // (those would force alphaMode=MASK and "eat" the mesh in Blender).
    if (bestByClass.alpha && bestByClass.alpha.score >= 80) {
        const n = bestByClass.alpha.base.toLowerCase();
        if (/opacity|cutout|alphamask|alpha_mask|_opacity/.test(n)) {
            map.alpha = bestByClass.alpha.base;
        }
    }
    // unknown high-score as last-resort albedo
    if (!map.albedo && bestByClass.unknown && bestByClass.unknown.score >= 60) {
        map.albedo = bestByClass.unknown.base;
    }
    return Object.keys(map).length ? map : null;
}

/**
 * Resolve a texture set/image uid to a downloaded texture basename.
 */
export function resolveUidToBase(uid, textureList) {
    if (!uid) return null;
    const u = String(uid).toLowerCase();
    for (const t of textureList || []) {
        if (t.uid && String(t.uid).toLowerCase() === u) return textureBasename(t.name);
        if (t.imageUids && t.imageUids.some((id) => String(id).toLowerCase() === u)) {
            return textureBasename(t.name);
        }
        if (t.name && t.name.toLowerCase().includes(u)) return textureBasename(t.name);
    }
    return null;
}

function texDims(t) {
    if (!t) return { w: 0, h: 0 };
    if ((t.width || 0) > 0 && (t.height || 0) > 0) {
        return { w: t.width, h: t.height };
    }
    const d = t.data;
    if (d instanceof Uint8Array && d.length >= 24 && d[0] === 0x89 && d[1] === 0x50) {
        const w = ((d[16] << 24) | (d[17] << 16) | (d[18] << 8) | d[19]) >>> 0;
        const h = ((d[20] << 24) | (d[21] << 16) | (d[22] << 8) | d[23]) >>> 0;
        return { w, h };
    }
    return { w: 0, h: 0 };
}

function texMetaByName(textureList, name) {
    if (!name) return null;
    const b = textureBasename(name).toLowerCase();
    for (const t of textureList || []) {
        if (textureBasename(t.name).toLowerCase() === b) return t;
    }
    return null;
}

/**
 * Prefer a large color map on SpecularPBR when Diffuse/Albedo is a tiny
 * leftover (Maya often parks the real jeans/cloth atlas on SpecularPBR).
 * Never promote a name-classified specular/normal/ORM map.
 */
export function chooseAlbedoName(albedoName, specularName, textureList) {
    if (!specularName) return albedoName || null;
    const cls = classifyTextureName(specularName);
    if (cls === 'normal' || cls === 'metalrough' || cls === 'specular' || cls === 'alpha') {
        return albedoName || null;
    }
    const a = texMetaByName(textureList, albedoName);
    const s = texMetaByName(textureList, specularName);
    const aa = (() => {
        const d = texDims(a);
        return d.w * d.h;
    })();
    const sa = (() => {
        const d = texDims(s);
        return d.w * d.h;
    })();
    const weak = !albedoName || aa < 512 * 512;
    if (weak && sa > Math.max(aa, 1) * 2) return specularName;
    return albedoName || null;
}

/** Empty hair/line shells with no albedo AND no opacity atlas. */
export function shouldSkipUntexturedShell(spec, matName, geomName) {
    if (!spec) return false;
    if (spec.skipMesh) return true;
    if (spec.albedoUid || spec.opacityUid) return false;
    return /hair|line|brow|lash/i.test(String(matName || geomName || ''));
}

export function findViewerSpec(vm, matName, geomName) {
    if (!vm) return null;
    if (matName && vm.has(matName)) return { spec: vm.get(matName), via: 'viewer-uid' };
    const keys = [];
    vm.forEach((_, k) => keys.push(k));
    const tryNames = [matName, geomName].filter(Boolean);
    for (const raw of tryNames) {
        const id = identityKey(raw);
        if (!id || id === 'unnamed') continue;
        for (const k of keys) {
            if (identityKey(k) === id) return { spec: vm.get(k), via: 'stateset' };
        }
    }
    return null;
}

function sampleLum(rgba, w, h, u, v) {
    let x = Math.round(u * (w - 1));
    let y = Math.round(v * (h - 1));
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x >= w) x = w - 1;
    if (y >= h) y = h - 1;
    const o = (y * w + x) * 4;
    return (rgba[o] * 77 + rgba[o + 1] * 150 + rgba[o + 2] * 29) >> 8;
}

/**
 * Multiply an opacity map into the albedo's alpha channel.
 *
 * Reports whether the result actually carries transparency: Sketchfab ships a
 * flat white Opacity map for plenty of fully opaque materials, and exporting
 * those as BLEND makes Blender/EEVEE drop depth writes, so a solid object
 * renders see-through.
 *
 * @returns {Promise<{data: Uint8Array, hasTransparency: boolean}|null>}
 */
export async function bakeOpacityIntoAlbedo(albedoBytes, alphaBytes) {
    const a = await decodePngRgba(albedoBytes);
    const m = await decodePngRgba(alphaBytes);
    if (!a.width || !m.width) return null;
    const out = new Uint8ClampedArray(a.rgba);
    const same = a.width === m.width && a.height === m.height;
    let hasTransparency = false;
    for (let y = 0; y < a.height; y++) {
        for (let x = 0; x < a.width; x++) {
            const o = (y * a.width + x) * 4;
            const lum = same
                ? (m.rgba[o] * 77 + m.rgba[o + 1] * 150 + m.rgba[o + 2] * 29) >> 8
                : sampleLum(m.rgba, m.width, m.height, x / (a.width - 1 || 1), y / (a.height - 1 || 1));
            const v = Math.round((out[o + 3] * lum) / 255);
            out[o + 3] = v;
            if (v < 250) hasTransparency = true;
        }
    }
    return {
        data: await encodePngRgba(out, a.width, a.height),
        hasTransparency,
    };
}

async function bakeTintWithAlpha(factor, alphaBytes) {
    const m = await decodePngRgba(alphaBytes);
    if (!m.width) return null;
    const r = Math.round(Math.max(0, Math.min(1, factor[0] ?? 1)) * 255);
    const g = Math.round(Math.max(0, Math.min(1, factor[1] ?? 1)) * 255);
    const b = Math.round(Math.max(0, Math.min(1, factor[2] ?? 1)) * 255);
    let alphaUseful = false;
    const n = m.width * m.height;
    for (let i = 0; i < n; i++) {
        if (m.rgba[i * 4 + 3] < 250) {
            alphaUseful = true;
            break;
        }
    }
    const out = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        const lum = (m.rgba[o] * 77 + m.rgba[o + 1] * 150 + m.rgba[o + 2] * 29) >> 8;
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = alphaUseful ? m.rgba[o + 3] : lum;
    }
    return encodePngRgba(out, m.width, m.height);
}

/**
 * Build per-geometry texture maps.
 * Priority: viewer material channels (uid) > osg File refs > name heuristics.
 * @param {Map|object|null} viewerMaterials - from parseViewerMaterials
 */
function buildTextureMaps(geometries, textureList, textureFiles, viewerMaterials) {
    const byClass = {
        albedo: [], normal: [], metalrough: [], emissive: [],
        occlusion: [], alpha: [], lightmap: [], unknown: [], specular: [],
    };
    const list = textureList || [];
    for (const t of list) {
        const base = textureBasename(t.name);
        const cls = classifyTextureName(base);
        if (!byClass[cls]) byClass[cls] = [];
        byClass[cls].push(base);
    }

    const pickFirst = (...groups) => {
        for (const g of groups) {
            if (g && g.length) return g[0];
        }
        return null;
    };
    // Never pick specular/normal/ORM as albedo. Never list[0].
    const albedoSafeUnknown = (byClass.unknown || []).filter((n) => {
        const c = classifyTextureName(n);
        return c === 'unknown' || c === 'albedo';
    });
    const global = {
        albedo: pickFirst(byClass.albedo, albedoSafeUnknown),
        normal: pickFirst(byClass.normal),
        metalness: null,
        emissive: null,
        occlusion: null,
        alpha: null,
        metallicFactor: 0,
        roughnessFactor: 0.9,
        normalFlipY: true,
        baseColorFactor: [1, 1, 1, 1],
        via: 'classify',
    };

    const vm = viewerMaterials instanceof Map
        ? viewerMaterials
        : viewerMaterials
          ? new Map(Object.entries(viewerMaterials))
          : null;

    const perGeom = geometries.map((geom) => {
        const matName = geom.materialName || null;

        // 0) Viewer material channels (authoritative, by texture uid — filenames lie)
        let found = findViewerSpec(vm, matName, geom.name);
        if (!found && vm && vm.size === 1) {
            const only = vm.values().next().value;
            if (only && !only.skipMesh) found = { spec: only, via: 'single' };
        }
        if (found && found.spec) {
            const spec = found.spec;
            if (shouldSkipUntexturedShell(spec, matName, geom.name)) {
                return { skip: true };
            }
            let albedo = resolveUidToBase(spec.albedoUid, list);
            const specularName = resolveUidToBase(spec.specularUid, list);
            albedo = chooseAlbedoName(albedo, specularName, list);
            const alpha = resolveUidToBase(spec.opacityUid, list);
            const usedOpacityAsAlbedo = !albedo && !!alpha;
            if (usedOpacityAsAlbedo) albedo = alpha;
            let metalTex = resolveUidToBase(spec.metalnessUid, list);
            let metallicFactor = spec.metallicFactor != null ? spec.metallicFactor : 0;
            // Sketchfab often points MetalnessPBR at a *_D color/id map, not ORM.
            // Dropping it must also drop factor=1, or hair cards go chrome.
            if (metalTex && classifyTextureName(metalTex) === 'albedo') metalTex = null;
            if (spec.metalnessUid && !metalTex) metallicFactor = 0;
            // Sketchfab serves metalness and roughness separately; the pipeline
            // packs them into one ORM map. Only a genuinely packed texture may
            // drive metallicRoughnessTexture (see pbrFactors).
            let ormPacked = false;
            if (spec.packedOrmName) {
                metalTex = spec.packedOrmName;
                ormPacked = true;
            } else if (metalTex && isPackedOrmName(metalTex)) {
                ormPacked = true;
            }
            const map = {
                albedo,
                normal: resolveUidToBase(spec.normalUid, list),
                metalness: metalTex,
                ormPacked,
                emissive: resolveUidToBase(spec.emitUid, list),
                occlusion: resolveUidToBase(spec.aoUid, list),
                clearcoat: resolveUidToBase(spec.clearcoatUid, list),
                clearcoatRough: resolveUidToBase(spec.clearcoatRoughUid, list),
                clearcoatNormal: resolveUidToBase(spec.clearcoatNormalUid, list),
                sheen: resolveUidToBase(spec.sheenUid, list),
                sheenRough: resolveUidToBase(spec.sheenRoughUid, list),
                anisotropy: resolveUidToBase(spec.anisotropyUid, list),
                specularColor: resolveUidToBase(spec.specularColorUid, list),
                displacement: resolveUidToBase(spec.displacementUid, list),
                emitFactor: spec.emitFactor,
                emitColor: spec.emitColor,
                clearcoatFactor: spec.clearcoatFactor,
                clearcoatRoughnessFactor: spec.clearcoatRoughnessFactor,
                sheenColorFactor: spec.sheenColorFactor,
                sheenRoughnessFactor: spec.sheenRoughnessFactor,
                anisotropyStrength: spec.anisotropyStrength,
                anisotropyRotation: spec.anisotropyRotation,
                specularFactor: spec.specularFactor,
                specularColorFactor: spec.specularColorFactor,
                ior: spec.ior,
                displacementFactor: spec.displacementFactor,
                volumeThickness: spec.volumeThickness,
                attenuationColor: spec.attenuationColor,
                alpha,
                metallicFactor,
                roughnessFactor: spec.roughnessFactor != null ? spec.roughnessFactor : 0.9,
                normalFlipY: !!spec.normalFlipY,
                // Opacity-only cards keep the viewer tint. Real albedo must not
                // be multiplied by a leftover DiffuseColor.
                baseColorFactor: usedOpacityAsAlbedo
                    ? (spec.baseColorFactor || [1, 1, 1, 1])
                    : albedo
                      ? [1, 1, 1, 1]
                      : (spec.baseColorFactor || [1, 1, 1, 1]),
                opacityEnable: !!spec.opacityEnable,
                opacityFactor: spec.opacityFactor,
                opacityType: spec.opacityType,
                transmission: !!spec.transmission,
                opacityAsAlbedo: usedOpacityAsAlbedo,
                via: found.via,
            };
            // Only name-fallback when the viewer pointed at a uid we failed to resolve.
            // Hair_03 / untextured shells have albedoUid=null — do not steal Hair_D.
            if (!map.albedo && spec.albedoUid) {
                const byName = mapTexturesForName(matName, geom.name, list);
                if (byName && byName.albedo) map.albedo = byName.albedo;
                if (byName && byName.normal && !map.normal) map.normal = byName.normal;
            }
            return map;
        }

        // 1) Explicit File refs from osgjs (rare)
        if (geom.textureFiles && geom.textureFiles.length) {
            const map = {
                metallicFactor: 0,
                roughnessFactor: 0.9,
                normalFlipY: true,
                baseColorFactor: [1, 1, 1, 1],
            };
            for (const ref of geom.textureFiles) {
                const hit = findTextureBytes(ref, textureFiles);
                if (!hit) continue;
                const base = textureBasename(hit.key);
                const cls = classifyTextureName(base);
                if (cls === 'normal') map.normal = base;
                else if (cls === 'metalrough') map.metalness = base;
                else if (cls === 'emissive') map.emissive = base;
                else if (cls === 'occlusion') map.occlusion = base;
                else if (cls === 'lightmap' || cls === 'specular') { /* skip */ }
                else map.albedo = base;
            }
            if (map.albedo || map.normal) return map;
        }

        // 2) Name heuristics — albedo (+ normal only), never auto-ORM
        const byName = mapTexturesForName(geom.materialName, geom.name, list);
        if (byName) {
            return {
                albedo: byName.albedo || global.albedo,
                normal: byName.normal || null,
                metalness: null, // don't invent ORM
                emissive: byName.emissive || null,
                occlusion: null,
                alpha: byName.alpha || null,
                metallicFactor: 0,
                roughnessFactor: 0.9,
                normalFlipY: true,
                baseColorFactor: [1, 1, 1, 1],
                via: 'classify',
            };
        }

        return global.albedo
            ? { ...global }
            : {
                metallicFactor: 0,
                roughnessFactor: 0.9,
                normalFlipY: true,
                baseColorFactor: [1, 1, 1, 1],
            };
    });

    return { global, perGeom };
}

// --- glTF builder ---

function buildGLTF(geometries, textureMap, textureFiles, perGeomMaps, options = {}) {
    const hasSkin = (geometries || []).some((g) => g && g.boneMap);
    const externalTextures = !!options.externalTextures;
    const rootName = (options.modelName && String(options.modelName).trim()) || 'Sketchfab_model';
    const graph = options.graph || null;
    const animFileMap = options.animFileMap || null;
    const osgAnimations = options.osgAnimations || [];
    const gltf = {
        asset: { version: '2.0', generator: 'osgjs-to-gltf-converter' },
        scene: 0,
        scenes: [{ name: 'scene', nodes: [] }],
        nodes: [],
        meshes: [],
        accessors: [],
        bufferViews: [],
        buffers: [],
        materials: [],
        textures: [],
        images: [],
        samplers: []
    };
    // Extensions are only declared when a material actually emits one.
    const usedExtensions = new Set();

    const binChunks = [];
    let byteOffset = 0;

    function addAccessor(data, type, componentType, count, itemSize, normalized) {
        const typeMap = { 1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4', 16: 'MAT4' };
        let buf;
        // Prefer view over copy when already the right TypedArray
        if (componentType === 5126) {
            buf = data instanceof Float32Array ? data : new Float32Array(data.buffer ? data : Array.from(data));
        } else if (componentType === 5125) {
            buf = data instanceof Uint32Array ? data : new Uint32Array(data.buffer ? data : Array.from(data));
        } else if (componentType === 5123) {
            buf = data instanceof Uint16Array ? data : new Uint16Array(data.buffer ? data : Array.from(data));
        } else if (componentType === 5121) {
            buf = data instanceof Uint8Array ? data : new Uint8Array(data.buffer ? data : Array.from(data));
        } else {
            buf = new Float32Array(data);
        }

        const bytes = typedToBytes(buf);
        const padded = pad4(bytes, 0);

        const bvIdx = gltf.bufferViews.length;
        // Indices (SCALAR + 5125/5123) must not have byteStride
        const isIndex = type === 'SCALAR' && (componentType === 5125 || componentType === 5123);
        const isMat4 = itemSize === 16;
        gltf.bufferViews.push({
            buffer: 0, byteOffset, byteLength: bytes.length,
            ...(!isIndex && !isMat4 && itemSize > 1 ? { byteStride: itemSize * buf.BYTES_PER_ELEMENT } : {})
        });

        // glTF forbids min/max on MAT2/MAT3/MAT4.
        let bounds;
        if (!isMat4) {
            const min = [], max = [];
            for (let j = 0; j < itemSize; j++) { min.push(Infinity); max.push(-Infinity); }
            for (let i = 0; i < count; i++) {
                for (let j = 0; j < itemSize; j++) {
                    const v = buf[i * itemSize + j];
                    if (v < min[j]) min[j] = v;
                    if (v > max[j]) max[j] = v;
                }
            }
            bounds = { min, max };
        }

        const accIdx = gltf.accessors.length;
        gltf.accessors.push({
            bufferView: bvIdx, byteOffset: 0, componentType,
            count, type: typeMap[itemSize] || 'SCALAR',
            ...bounds,
            ...(normalized ? { normalized: true } : {})
        });

        binChunks.push(padded);
        byteOffset += padded.length;
        return accIdx;
    }

    // Sampler: linear filtering + REPEAT (UDIM-style UVs already wrapped to [0,1]).
    // Avoid MIPMAP minFilter — embedded images have no precomputed mips; some
    // importers sample badly with LINEAR_MIPMAP_LINEAR on GLB buffer images.
    gltf.samplers.push({ magFilter: 9729, minFilter: 9729, wrapS: 10497, wrapT: 10497 });

    // Cache filename → texture index so multi-material shares images
    const texIndexCache = Object.create(null);

    // Optional sync placeholder — flipNormalY applied later async-free via preprocessed textureFiles
    function addImage(filename, opts = {}) {
        if (!filename || !textureFiles) return -1;
        // Prefer pre-flipped normal map when requested (keys registered as name.__flipY)
        let hit = null;
        if (opts.flipNormalY) {
          const bare = textureBasename(filename);
          hit =
            findTextureBytes(filename + '.__flipY', textureFiles) ||
            findTextureBytes(bare + '.__flipY', textureFiles) ||
            findTextureBytes('textures/' + bare + '.__flipY', textureFiles);
        }
        if (!hit) hit = findTextureBytes(filename, textureFiles);
        if (!hit) return -1;
        const imgData = hit.data;
        const keyName = hit.key.replace(/\.__flipY$/, '');
        const bare = textureBasename(keyName) + (opts.flipNormalY ? '_flipY' : '');
        const mimeType = mimeFromName(keyName);
        const imgIdx = gltf.images.length;

        // External .gltf mode: reference textures/ on disk (Blender loads these reliably)
        if (externalTextures) {
            const uriBare = textureBasename(keyName);
            gltf.images.push({
                uri: 'textures/' + uriBare,
                mimeType,
                name: uriBare,
            });
            return imgIdx;
        }

        // Embedded GLB mode
        const raw = imgData instanceof Uint8Array ? imgData : new Uint8Array(imgData);
        const padded = pad4(raw, 0);
        const bvIdx = gltf.bufferViews.length;
        // Image bufferViews: no byteStride; byteLength = unpadded image size
        gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength: raw.length });
        byteOffset += padded.length;
        binChunks.push(padded);
        gltf.images.push({ bufferView: bvIdx, mimeType, name: bare });
        return imgIdx;
    }

    function addTexture(filename, opts = {}) {
        if (!filename) return -1;
        const flip = !!opts.flipNormalY;
        const cacheKey = String(filename).split('/').pop().toLowerCase() + (flip ? '|fy' : '');
        if (texIndexCache[cacheKey] !== undefined) return texIndexCache[cacheKey];
        const imgIdx = addImage(filename, opts);
        if (imgIdx < 0) {
            texIndexCache[cacheKey] = -1;
            return -1;
        }
        const texIdx = gltf.textures.length;
        gltf.textures.push({ source: imgIdx, sampler: 0 });
        texIndexCache[cacheKey] = texIdx;
        return texIdx;
    }

    /**
     * Build a glTF PBR material from viewer channel specs.
     * Defaults match Sketchfab lit/PBR: metalness 0, no invented ORM maps.
     */
    function makeMaterial(name, map) {
        const baseF = (map && map.baseColorFactor) || [1, 1, 1, 1];
        const factors = pbrFactors(map);
        const material = {
            name: name || 'Material',
            doubleSided: true,
            pbrMetallicRoughness: {
                baseColorFactor: baseF.slice(0, 4),
                metallicFactor: factors.metallicFactor,
                roughnessFactor: factors.roughnessFactor,
            }
        };
        if (map && map.via) {
            material.extras = { via: map.via };
        }

        if (map) {
            if (map.albedo) {
                const idx = addTexture(map.albedo);
                if (idx >= 0) {
                    material.pbrMetallicRoughness.baseColorTexture = { index: idx, texCoord: 0 };
                }
            }
            if (map.metalness && factors.bindTexture) {
                const idx = addTexture(map.metalness);
                if (idx >= 0) {
                    material.pbrMetallicRoughness.metallicRoughnessTexture = {
                        index: idx,
                        texCoord: 0,
                    };
                }
            }
            if (map.normal) {
                // flipY handled when packing texture bytes (see flipNormalMapY)
                const idx = addTexture(map.normal, { flipNormalY: !!map.normalFlipY });
                if (idx >= 0) material.normalTexture = { index: idx, texCoord: 0, scale: 1 };
            }
            if (map.emissive) {
                const idx = addTexture(map.emissive);
                if (idx >= 0) {
                    material.emissiveTexture = { index: idx, texCoord: 0 };
                    material.emissiveFactor = map.emitColor || [1, 1, 1];
                }
            } else if (map.emitColor && map.emitFactor > 0 && map.emitColor.some((c) => c > 0)) {
                const f = Math.min(1, map.emitFactor || 1);
                material.emissiveFactor = map.emitColor.map((c) => c * f);
            }
            if (map.emitFactor > 1) {
                material.extensions = material.extensions || {};
                material.extensions.KHR_materials_emissive_strength = {
                    emissiveStrength: map.emitFactor,
                };
                usedExtensions.add('KHR_materials_emissive_strength');
            }
            if (map.occlusion) {
                const idx = addTexture(map.occlusion);
                if (idx >= 0) material.occlusionTexture = { index: idx, texCoord: 0, strength: 1 };
            }
            // Opacity / cutout from viewer material
            const opType = String(map.opacityType || '');
            if (map.transmission) {
                // Sketchfab "refraction" glass. KHR_materials_transmission keeps
                // it see-through while the roughness map still drives the
                // reflection, which BLEND cannot do. Spec says stay OPAQUE.
                material.extensions = material.extensions || {};
                material.extensions.KHR_materials_transmission = { transmissionFactor: 1 };
                material.alphaMode = 'OPAQUE';
                material.doubleSided = false;
                usedExtensions.add('KHR_materials_transmission');
            } else if (map.forceOpaque) {
                // Opacity map baked out to fully opaque — see bakeOpacityIntoAlbedo
                material.alphaMode = 'OPAQUE';
            } else if (map.opacityEnable && /dither/i.test(opType)) {
                // Dithered hair cards: albedo (Hair_AO) and opacity (Hair_M) are
                // different atlases / UV sets. Official export uses BLEND, no bake.
                material.alphaMode = 'BLEND';
            } else if (map.opacityEnable && map.alpha) {
                if (opType === 'mask' || /mask|cutout/i.test(opType)) {
                    material.alphaMode = 'MASK';
                    material.alphaCutoff = 0.5;
                } else if (opType === 'alphaBlend' || opType === 'blend' || opType === 'additive' || !opType) {
                    material.alphaMode = 'BLEND';
                } else {
                    material.alphaMode = 'OPAQUE';
                }
            } else if (map.alpha && /opacity|cutout|alphamask/i.test(map.alpha)) {
                material.alphaMode = 'MASK';
                material.alphaCutoff = 0.5;
            } else {
                material.alphaMode = 'OPAQUE';
            }

            const ext = (name, body) => {
                material.extensions = material.extensions || {};
                material.extensions[name] = body;
                usedExtensions.add(name);
            };
            if (options.viewerScene && options.viewerScene.unlit) {
                ext('KHR_materials_unlit', {});
            }
            if (map.clearcoatFactor > 0 || map.clearcoat) {
                const cc = {
                    clearcoatFactor: map.clearcoatFactor || (map.clearcoat ? 1 : 0),
                    clearcoatRoughnessFactor: map.clearcoatRoughnessFactor || 0,
                };
                const cci = addTexture(map.clearcoat);
                if (cci >= 0) cc.clearcoatTexture = { index: cci, texCoord: 0 };
                const ccri = addTexture(map.clearcoatRough);
                if (ccri >= 0) cc.clearcoatRoughnessTexture = { index: ccri, texCoord: 0 };
                const ccni = addTexture(map.clearcoatNormal, { flipNormalY: !!map.normalFlipY });
                if (ccni >= 0) cc.clearcoatNormalTexture = { index: ccni, texCoord: 0 };
                ext('KHR_materials_clearcoat', cc);
            }
            const sheenColor = map.sheenColorFactor || [0, 0, 0];
            if (map.sheen || sheenColor.some((c) => c > 0)) {
                const sh = {
                    sheenColorFactor: sheenColor,
                    sheenRoughnessFactor: map.sheenRoughnessFactor || 0,
                };
                const shi = addTexture(map.sheen);
                if (shi >= 0) sh.sheenColorTexture = { index: shi, texCoord: 0 };
                const shri = addTexture(map.sheenRough);
                if (shri >= 0) sh.sheenRoughnessTexture = { index: shri, texCoord: 0 };
                ext('KHR_materials_sheen', sh);
            }
            if (map.anisotropyStrength > 0 || map.anisotropy) {
                const an = {
                    anisotropyStrength: map.anisotropyStrength || (map.anisotropy ? 1 : 0),
                    anisotropyRotation: map.anisotropyRotation || 0,
                };
                const ani = addTexture(map.anisotropy);
                if (ani >= 0) an.anisotropyTexture = { index: ani, texCoord: 0 };
                ext('KHR_materials_anisotropy', an);
            }
            const specColor = map.specularColorFactor || [1, 1, 1];
            const specF = map.specularFactor;
            if (
                map.specularColor ||
                (typeof specF === 'number' && specF !== 1) ||
                specColor.some((c, i) => Math.abs(c - 1) > 1e-4)
            ) {
                const sp = {
                    specularFactor: typeof specF === 'number' ? specF : 1,
                    specularColorFactor: specColor,
                };
                const spi = addTexture(map.specularColor);
                if (spi >= 0) sp.specularColorTexture = { index: spi, texCoord: 0 };
                ext('KHR_materials_specular', sp);
            }
            if (typeof map.ior === 'number' && Math.abs(map.ior - 1.5) > 1e-4) {
                ext('KHR_materials_ior', { ior: map.ior });
            }
            if (map.displacement && map.displacementFactor) {
                const di = addTexture(map.displacement);
                if (di >= 0) {
                    ext('KHR_materials_displacement', {
                        displacementGeometryTexture: { index: di, texCoord: 0 },
                        displacementGeometryFactor: map.displacementFactor,
                    });
                }
            }
            if (map.volumeThickness > 0) {
                if (!material.extensions || !material.extensions.KHR_materials_transmission) {
                    ext('KHR_materials_transmission', { transmissionFactor: 0.1 });
                }
                ext('KHR_materials_volume', {
                    thicknessFactor: map.volumeThickness,
                    attenuationColor: map.attenuationColor || [1, 1, 1],
                });
            }
        }

        return material;
    }

    // Material cache keyed by map signature
    const matCache = Object.create(null);
    function materialIndexFor(map, geomName) {
        const key = map
            ? [
                'a:' + (map.albedo || ''),
                'n:' + (map.normal || ''),
                'm:' + (map.metalness || ''),
                'op:' + (map.ormPacked ? 1 : 0),
                'e:' + (map.emissive || ''),
                'o:' + (map.occlusion || ''),
                'mf:' + (map.metallicFactor != null ? map.metallicFactor : ''),
                'rf:' + (map.roughnessFactor != null ? map.roughnessFactor : ''),
                'fy:' + (map.normalFlipY ? 1 : 0),
                'al:' + (map.alpha || ''),
                'oe:' + (map.opacityEnable ? 1 : 0),
                'ot:' + (map.opacityType || ''),
                'cc:' + (map.clearcoat || '') + ':' + (map.clearcoatFactor || 0),
                'sh:' + (map.sheen || '') + ':' + (map.sheenColorFactor || ''),
                'an:' + (map.anisotropyStrength || 0),
                'sp:' + (map.specularFactor || '') + ':' + (map.ior || ''),
                'dp:' + (map.displacement || '') + ':' + (map.displacementFactor || 0),
                'vl:' + (map.volumeThickness || 0),
                'ef:' + (map.emitFactor || ''),
              ].join('|')
            : '__default__';
        if (matCache[key] !== undefined) return matCache[key];
        const mat = makeMaterial(geomName || 'Material', map);
        const idx = gltf.materials.length;
        gltf.materials.push(mat);
        matCache[key] = idx;
        return idx;
    }

    // Ensure at least one material exists (fallback if no meshes pass filters)
    if (!textureMap) textureMap = null;

    const geomMeshIdx = new Array(geometries.length).fill(-1);
    let geomI = 0;
    for (const geom of geometries) {
        if (!geom.indices || !geom.attributes.POSITION) { geomI++; continue; }

        const map = (perGeomMaps && perGeomMaps[geomI]) || textureMap;
        // Skip glass / invisible rim shells (viewer opacity 0 or additive ghost)
        if (map && map.skip) { geomI++; continue; }
        const gname = geom.name || '';
        if (/glass/i.test(gname) || /rim_?hero/i.test(gname)) {
            // only keep if material explicitly has solid albedo
            if (!map || !map.albedo) { geomI++; continue; }
        }
        const matName =
            geom.materialName ||
            geom.name ||
            ('Material_' + geomI);
        const matIdx = materialIndexFor(map, matName);

        const primitive = { attributes: {}, material: matIdx, mode: 4 };

        // Indices
        const idx = geom.indices;
        const idxType = idx.BYTES_PER_ELEMENT === 4 ? 5125 : 5123;
        primitive.indices = addAccessor(idx, 'SCALAR', idxType, idx.length, 1);

        // Attributes — only standard glTF attribute names (skip junk COLOR_0 already)
        for (const [name, attr] of Object.entries(geom.attributes)) {
            if (name.startsWith('_')) continue;
            // Prefer TEXCOORD_0 only if present; skip empty higher sets already dropped
            const ct = attr.componentType || 5126;
            const norm = attr.normalized || false;
            primitive.attributes[name] = addAccessor(
                attr.data,
                name === 'SCALAR' ? 'SCALAR' : `VEC${attr.itemSize}`,
                ct,
                attr.count,
                attr.itemSize,
                norm
            );
        }

        // Safety: if no TEXCOORD_0 but material uses textures, Blender won't show maps
        if (
            !primitive.attributes.TEXCOORD_0 &&
            map &&
            (map.albedo || map.normal || map.metalness)
        ) {
            // synthesize 0,0 UVs so importers still bind the image node
            const nVerts = geom.attributes.POSITION.count;
            const zeros = new Float32Array(nVerts * 2);
            primitive.attributes.TEXCOORD_0 = addAccessor(zeros, 'VEC2', 5126, nVerts, 2, false);
        }

        // Remove byteStride from index bufferViews (safety)
        const idxBV = gltf.accessors[primitive.indices].bufferView;
        delete gltf.bufferViews[idxBV].byteStride;

        // One mesh per geometry — Blender multi-material on a single
        // multi-primitive mesh is flaky; separate objects import textures reliably.
        const meshIdx = gltf.meshes.length;
        const meshName = (geom.name || matName || ('Mesh_' + geomI)).slice(0, 64);
        const mesh = { name: meshName, primitives: [primitive] };
        if (geom.morphTargets && geom.morphTargets.length) {
            primitive.targets = geom.morphTargets.map((attrs) => {
                const target = {};
                for (const [name, attr] of Object.entries(attrs)) {
                    target[name] = addAccessor(
                        attr.data,
                        `VEC${attr.itemSize}`,
                        5126,
                        attr.count,
                        attr.itemSize,
                        false
                    );
                }
                return target;
            });
            mesh.weights = geom.morphTargets.map(() => 0);
            if (geom.morphTargetNames && geom.morphTargetNames.length) {
                mesh.extras = { targetNames: geom.morphTargetNames.slice() };
            }
        }
        gltf.meshes.push(mesh);
        geomMeshIdx[geomI] = meshIdx;
        geomI++;
    }

    function nodeFromGraph(gNode, meshIds) {
        const node = {};
        if (gNode.name) node.name = gNode.name;
        if (gNode.matrix && !isIdentityMat4(gNode.matrix)) {
            if (hasSkin) {
                // Official Sketchfab flips the FBX "Animata" −90°X node to +90°X
                // and puts −90°X on Sketchfab_model. Keep other locals in Z-up.
                if (isApproxMat4(gNode.matrix, YUP_FROM_ZUP)) {
                    node.rotation = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
                } else {
                    node.matrix = gNode.matrix.slice();
                }
            } else {
                node.matrix = conjugateZupToYup(gNode.matrix);
            }
        }
        if (meshIds.length === 1) node.mesh = meshIds[0];
        if (gNode.aliases && gNode.aliases.length) {
            node.extras = Object.assign({}, node.extras, { osgUpdateNames: gNode.aliases.slice() });
        }
        return node;
    }

    const meshNodes = [];
    const graphNodes = graph && Array.isArray(graph.nodes) ? graph.nodes : null;
    const graphRoots = graph && Array.isArray(graph.roots) ? graph.roots : [];
    const graphToGltf = graphNodes ? new Array(graphNodes.length).fill(-1) : null;

    if (graphNodes && graphRoots.length) {
        const emitGraph = (gIdx) => {
            const gNode = graphNodes[gIdx];
            if (!gNode) return -1;
            const meshIds = [];
            for (const gi of gNode.meshes || []) {
                const mi = geomMeshIdx[gi];
                if (mi >= 0) meshIds.push(mi);
            }
            const childIdxs = [];
            for (const c of gNode.children || []) {
                const n = emitGraph(c);
                if (n >= 0) childIdxs.push(n);
            }
            // Extra meshes become child nodes so each glTF node has at most one mesh.
            if (meshIds.length > 1) {
                for (let i = 1; i < meshIds.length; i++) {
                    const extra = { mesh: meshIds[i] };
                    const mesh = gltf.meshes[meshIds[i]];
                    if (mesh && mesh.name) extra.name = mesh.name;
                    childIdxs.push(gltf.nodes.length);
                    gltf.nodes.push(extra);
                }
            }
            const node = nodeFromGraph(gNode, meshIds.slice(0, 1));
            if (childIdxs.length) node.children = childIdxs;
            const nodeIdx = gltf.nodes.length;
            gltf.nodes.push(node);
            graphToGltf[gIdx] = nodeIdx;
            return nodeIdx;
        };
        for (const r of graphRoots) {
            const n = emitGraph(r);
            if (n >= 0) meshNodes.push(n);
        }
    }

    if (!meshNodes.length) {
        for (let i = 0; i < geomMeshIdx.length; i++) {
            if (geomMeshIdx[i] < 0) continue;
            const meshIdx = geomMeshIdx[i];
            const meshName = (gltf.meshes[meshIdx] && gltf.meshes[meshIdx].name) || ('Mesh_' + i);
            const nodeIdx = gltf.nodes.length;
            gltf.nodes.push({ name: meshName, mesh: meshIdx });
            meshNodes.push(nodeIdx);
        }
    }

    if (meshNodes.length) {
        // Skinned: match official Sketchfab_model (−90°X) so Y-up verts +
        // Z-up bones/IBMs skin correctly. Unskinned: nodes already conjugated.
        const root = gltf.nodes.length;
        const rootNode = {
            name: rootName,
            children: meshNodes.slice(),
        };
        if (hasSkin) rootNode.matrix = YUP_FROM_ZUP.slice();
        gltf.nodes.push(rootNode);
        gltf.scenes[0].nodes = [root];
    } else {
        gltf.meshes.push({ primitives: [] });
        gltf.nodes.push({ mesh: 0, name: 'root' });
        gltf.scenes[0].nodes = [gltf.nodes.length - 1];
    }

    const viewerScene = options.viewerScene || null;
    if (viewerScene && viewerScene.camera) {
        const cam = viewerScene.camera;
        const eye = cam.position;
        const dest = cam.target;
        const dist = Math.hypot(eye[0] - dest[0], eye[1] - dest[1], eye[2] - dest[2]) || 1;
        const ratio = viewerScene.nearFarRatio || 0.005;
        const znear = Math.max(dist * ratio, dist / 2000);
        const zfar = Math.max(dist * 40, znear * 100);
        gltf.cameras = gltf.cameras || [];
        const camIdx = gltf.cameras.length;
        gltf.cameras.push({
            type: 'perspective',
            perspective: {
                yfov: cam.yfov || Math.PI / 4,
                znear,
                zfar,
                aspectRatio: 1.5,
            },
        });
        const camNode = gltf.nodes.length;
        gltf.nodes.push({
            name: 'Camera',
            camera: camIdx,
            translation: eye.slice(0, 3),
            rotation: lookAtRotation(eye, dest),
        });
        gltf.scenes[0].nodes.push(camNode);
    }
    if (viewerScene && viewerScene.lights && viewerScene.lights.length) {
        const lights = [];
        for (let i = 0; i < viewerScene.lights.length; i++) {
            const L = viewerScene.lights[i];
            const def = {
                type: L.type,
                color: L.color || [1, 1, 1],
                intensity: L.intensity != null ? L.intensity : 1,
            };
            if (L.type === 'spot') {
                def.spot = {
                    outerConeAngle: L.outerConeAngle != null ? L.outerConeAngle : Math.PI / 4,
                };
            }
            lights.push(def);
            const tr = mat4TranslationRotation(L.matrix);
            const node = {
                name: 'Light_' + i,
                translation: tr.translation,
                rotation: tr.rotation,
                extensions: { KHR_lights_punctual: { light: i } },
            };
            const ni = gltf.nodes.length;
            gltf.nodes.push(node);
            gltf.scenes[0].nodes.push(ni);
        }
        gltf.extensions = gltf.extensions || {};
        gltf.extensions.KHR_lights_punctual = { lights };
        usedExtensions.add('KHR_lights_punctual');
    }

    if (graphNodes && graphToGltf) {
        const boneNameToGltf = Object.create(null);
        const boneNameToGraph = Object.create(null);
        for (let g = 0; g < graphNodes.length; g++) {
            const gn = graphNodes[g];
            if (gn.kind !== 'bone' || !gn.name || graphToGltf[g] < 0) continue;
            if (boneNameToGltf[gn.name] === undefined) {
                boneNameToGltf[gn.name] = graphToGltf[g];
                boneNameToGraph[gn.name] = g;
            }
        }

        const meshToSkin = [];
        const skinByKey = Object.create(null);

        const findSkeletonGltf = (boneMap) => {
            const firstName = Object.keys(boneMap)[0];
            let i = firstName ? boneNameToGraph[firstName] : undefined;
            while (i >= 0) {
                if (graphNodes[i].kind === 'skeleton' && graphToGltf[i] >= 0) {
                    return graphToGltf[i];
                }
                i = graphNodes[i].parent;
            }
            return firstName !== undefined ? boneNameToGltf[firstName] : undefined;
        };

        const emitSkin = (boneMap) => {
            const namesByJoint = [];
            let maxJoint = -1;
            for (const [name, ji] of Object.entries(boneMap)) {
                const idx = Number(ji);
                if (!Number.isInteger(idx) || idx < 0) continue;
                namesByJoint[idx] = name;
                if (idx > maxJoint) maxJoint = idx;
            }
            if (maxJoint < 0) return -1;
            const joints = [];
            const ibmData = new Float32Array((maxJoint + 1) * 16);
            for (let i = 0; i <= maxJoint; i++) {
                const name = namesByJoint[i];
                const nodeIdx = name !== undefined ? boneNameToGltf[name] : undefined;
                if (nodeIdx === undefined) return -1;
                joints.push(nodeIdx);
                const gIdx = boneNameToGraph[name];
                // Official Sketchfab GLB keeps InvBindMatrixInSkeletonSpace
                // as-is. Conjugating it into Y-up while verts/joints are already
                // remapped explodes the rest pose (eagle AABB 372 vs 143).
                const raw = (gIdx >= 0 && graphNodes[gIdx].invBindMatrix) || IDENTITY_MAT4;
                ibmData.set(raw, i * 16);
            }
            const skin = {
                joints,
                inverseBindMatrices: addAccessor(ibmData, 'MAT4', 5126, joints.length, 16),
            };
            const skel = findSkeletonGltf(boneMap);
            if (skel !== undefined) skin.skeleton = skel;
            if (!gltf.skins) gltf.skins = [];
            const skinIdx = gltf.skins.length;
            gltf.skins.push(skin);
            return skinIdx;
        };

        for (let gi = 0; gi < geometries.length; gi++) {
            const meshIdx = geomMeshIdx[gi];
            const boneMap = geometries[gi] && geometries[gi].boneMap;
            if (meshIdx < 0 || !boneMap) continue;
            const key = Object.entries(boneMap)
                .sort((a, b) => Number(a[1]) - Number(b[1]))
                .map(([n, i]) => i + ':' + n)
                .join('|');
            if (skinByKey[key] === undefined) skinByKey[key] = emitSkin(boneMap);
            if (skinByKey[key] >= 0) meshToSkin[meshIdx] = skinByKey[key];
        }

        for (const node of gltf.nodes) {
            if (node.mesh === undefined) continue;
            const skinIdx = meshToSkin[node.mesh];
            if (skinIdx !== undefined) node.skin = skinIdx;
        }
    }

    const animDebug = options.animDebug || {
        clipsInOsgjs: osgAnimations.length,
        emitted: [],
        skips: [],
    };
    animDebug.clipsInOsgjs = osgAnimations.length;

    if (osgAnimations.length && animFileMap) {
        const animations = [];
        for (const clip of osgAnimations) {
            const samplers = [];
            const channels = [];
            const weightGroups = new Map();
            let clipSkips = 0;
            for (const wrap of clip.Channels || []) {
                const chInfo = unwrapOsgChannel(wrap);
                if (!chInfo) {
                    animDebug.skips.push({ clip: clip.Name, reason: 'unknown-channel-type' });
                    clipSkips++;
                    continue;
                }
                const decoded = decodeAnimChannel(chInfo, animFileMap);
                if (!decoded || decoded.missingBin || !decoded.times) {
                    animDebug.skips.push({
                        clip: clip.Name,
                        target: chInfo.payload && chInfo.payload.TargetName,
                        path: chInfo.payload && chInfo.payload.Name,
                        reason: decoded && decoded.missingBin ? 'missing-bin' : 'decode-failed',
                    });
                    clipSkips++;
                    continue;
                }
                const path = gltfPathForChannel(decoded);
                if (!path) {
                    animDebug.skips.push({
                        clip: clip.Name,
                        target: decoded.targetName,
                        path: decoded.name,
                        reason: 'unknown-path',
                    });
                    clipSkips++;
                    continue;
                }
                if (path === 'weights') {
                    const hit = findMorphTargetNode(gltf, decoded.targetName);
                    if (!hit) {
                        animDebug.skips.push({
                            clip: clip.Name,
                            target: decoded.targetName,
                            path,
                            reason: 'missing-morph-node',
                        });
                        clipSkips++;
                        continue;
                    }
                    const idx = parseInt(decoded.name, 10);
                    if (!Number.isInteger(idx) || idx < 0) continue;
                    if (!weightGroups.has(hit.nodeIdx)) {
                        weightGroups.set(hit.nodeIdx, { weightCount: hit.weightCount, tracks: [] });
                    }
                    weightGroups.get(hit.nodeIdx).tracks.push({ index: idx, times: decoded.times, values: decoded.values });
                    continue;
                }
                const nodeIdx = findNodeByName(gltf, decoded.targetName);
                if (nodeIdx < 0) {
                    animDebug.skips.push({
                        clip: clip.Name,
                        target: decoded.targetName,
                        path,
                        reason: 'missing-node',
                    });
                    clipSkips++;
                    continue;
                }
                ensureNodeTrs(gltf.nodes[nodeIdx]);
                if (!hasSkin) applyYupToChannel(decoded, path);
                const itemSize = path === 'rotation' ? 4 : 3;
                const input = addAccessor(decoded.times, 'SCALAR', 5126, decoded.times.length, 1);
                const count = Math.floor(decoded.values.length / itemSize);
                const output = addAccessor(decoded.values, path === 'rotation' ? 'VEC4' : 'VEC3', 5126, count, itemSize);
                const si = samplers.length;
                samplers.push({ input, output, interpolation: 'LINEAR' });
                channels.push({ sampler: si, target: { node: nodeIdx, path } });
            }
            for (const [nodeIdx, group] of weightGroups) {
                const merged = mergeWeightTracks(group.tracks, group.weightCount);
                const input = addAccessor(merged.times, 'SCALAR', 5126, merged.times.length, 1);
                const outCount = merged.times.length * group.weightCount;
                const output = addAccessor(merged.values, 'SCALAR', 5126, outCount, 1);
                const si = samplers.length;
                samplers.push({ input, output, interpolation: 'LINEAR' });
                channels.push({ sampler: si, target: { node: nodeIdx, path: 'weights' } });
            }
            if (channels.length) {
                animations.push({
                    name: clip.Name || 'Animation',
                    samplers,
                    channels,
                });
                animDebug.emitted.push({
                    name: clip.Name || 'Animation',
                    channels: channels.length,
                    skipped: clipSkips,
                });
            } else {
                animDebug.skips.push({
                    clip: clip.Name,
                    reason: 'clip-empty',
                    skipped: clipSkips,
                });
            }
        }
        if (animations.length) gltf.animations = animations;
    } else if (osgAnimations.length && !animFileMap) {
        animDebug.skips.push({ reason: 'no-anim-file-map', clips: osgAnimations.length });
    }

    // Drop empty optional arrays (some strict validators dislike empty textures[])
    if (!gltf.images.length) {
        delete gltf.images;
        delete gltf.textures;
        delete gltf.samplers;
    }

    const binBuffer = concatBytes(binChunks);
    gltf.buffers.push({ byteLength: binBuffer.length });

    if (usedExtensions.size) {
        gltf.extensionsUsed = [...usedExtensions];
    }

    return { json: gltf, bin: binBuffer, animDebug };
}

// --- Recursive scene traversal ---

function buildUidMap(obj, map) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.UniqueID !== undefined && Object.keys(obj).length > 1) {
        map[obj.UniqueID] = obj;
    }
    for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(c => buildUidMap(c, map));
        else if (typeof v === 'object') buildUidMap(v, map);
    }
}

function resolveRefs(obj, uidMap) {
    if (!obj || typeof obj !== 'object') return obj;
    if (obj.UniqueID !== undefined && Object.keys(obj).length === 1) {
        const resolved = uidMap[obj.UniqueID];
        if (resolved) return resolved;
    }
    for (const [k, v] of Object.entries(obj)) {
        if (Array.isArray(v)) {
            obj[k] = v.map(c => typeof c === 'object' ? resolveRefs(c, uidMap) : c);
        } else if (typeof v === 'object') {
            obj[k] = resolveRefs(v, uidMap);
        }
    }
    return obj;
}

function isWireframeGeom(geom) {
    if (!geom) return false;
    const prims = geom.PrimitiveSetList || [];
    return prims.some((p) => {
        const dt = Object.values(p)[0];
        return dt && dt.Mode === 'LINES';
    });
}

function isOsgMeshKey(k) {
    return k === 'osg.Geometry'
        || k === 'osgAnimation.MorphGeometry'
        || k === 'osg.MorphGeometry';
}

function unwrapOsgMesh(obj) {
    if (!obj || typeof obj !== 'object') return null;
    for (const [k, v] of Object.entries(obj)) {
        if (isOsgMeshKey(k) && v && typeof v === 'object') return v;
    }
    if (obj.VertexAttributeList) return obj;
    return null;
}

/** Unwrap SourceGeometry / Morph / plain Geometry dict into osg.Geometry payload. */
function extractMeshGeometry(wrapper) {
    if (!wrapper || typeof wrapper !== 'object') return null;
    // Direct geometry (MorphGeometry base mesh is this shape)
    if (wrapper.PrimitiveSetList && wrapper.VertexAttributeList) return wrapper;
    if (wrapper['osg.Geometry']) return wrapper['osg.Geometry'];
    if (wrapper['osgAnimation.MorphGeometry']) return wrapper['osgAnimation.MorphGeometry'];
    if (wrapper['osg.MorphGeometry']) return wrapper['osg.MorphGeometry'];
    // RigGeometry / MorphGeometry hold the mesh under SourceGeometry
    const src = wrapper.SourceGeometry;
    if (src && typeof src === 'object') {
        if (src['osg.Geometry']) return src['osg.Geometry'];
        if (src['osgAnimation.MorphGeometry']) return src['osgAnimation.MorphGeometry'];
        if (src['osg.MorphGeometry']) return src['osg.MorphGeometry'];
        if (src.PrimitiveSetList && src.VertexAttributeList) return src;
        for (const [k, v] of Object.entries(src)) {
            if (k.startsWith('osg') && v && typeof v === 'object' && v.VertexAttributeList) {
                return v;
            }
        }
    }
    return null;
}

function morphTargetEntries(host) {
    if (!host || typeof host !== 'object') return null;
    if (Array.isArray(host.MorphTargets)) return host.MorphTargets;
    const wrapped = host['osgAnimation.MorphGeometry'] || host['osg.MorphGeometry'];
    if (wrapped && Array.isArray(wrapped.MorphTargets)) return wrapped.MorphTargets;
    const src = host.SourceGeometry;
    if (src && typeof src === 'object') {
        if (Array.isArray(src.MorphTargets)) return src.MorphTargets;
        const inner = src['osgAnimation.MorphGeometry'] || src['osg.MorphGeometry'];
        if (inner && Array.isArray(inner.MorphTargets)) return inner.MorphTargets;
    }
    return null;
}

function subtractAttr(target, base, itemSize) {
    const size = itemSize || 3;
    const count = Math.min(Math.floor(target.length / size), Math.floor(base.length / size));
    const dest = new Float32Array(count * size);
    for (let i = 0; i < count * size; i++) dest[i] = target[i] - base[i];
    return dest;
}

function attachMorphTargets(result, host, polyBin, wireBin) {
    const entries = morphTargetEntries(host);
    if (!entries || !entries.length || !result || !result.attributes || !result.attributes.POSITION) {
        return;
    }
    const baseGeom = extractMeshGeometry(host) || host;
    const basePos = result.attributes.POSITION;
    const baseNrm = result.attributes.NORMAL;
    const targets = [];
    const names = [];
    for (const entry of entries) {
        const tg = unwrapOsgMesh(entry);
        if (!tg || !tg.VertexAttributeList) continue;
        let decoded;
        try {
            decoded = processGeometry({
                Name: tg.Name,
                UserDataContainer: tg.UserDataContainer,
                VertexAttributeList: tg.VertexAttributeList,
                PrimitiveSetList: tg.PrimitiveSetList || baseGeom.PrimitiveSetList,
            }, polyBin, wireBin);
        } catch (_) {
            continue;
        }
        const pos = decoded.attributes && decoded.attributes.POSITION;
        if (!pos || pos.count !== basePos.count) continue;
        const attrs = {
            POSITION: {
                data: subtractAttr(pos.data, basePos.data, 3),
                itemSize: 3,
                count: pos.count,
            },
        };
        const nrm = decoded.attributes.NORMAL;
        if (nrm && baseNrm && nrm.count === baseNrm.count) {
            attrs.NORMAL = {
                data: subtractAttr(nrm.data, baseNrm.data, 3),
                itemSize: 3,
                count: nrm.count,
            };
        }
        targets.push(attrs);
        names.push(tg.Name || '');
    }
    if (targets.length) {
        result.morphTargets = targets;
        result.morphTargetNames = names;
    }
}

const SCENE_NODE_KEYS = [
    'osg.MatrixTransform',
    'osg.Node',
    'osgAnimation.Bone',
    'osgAnimation.Skeleton',
    'osg.Group',
];

function unwrapSceneNode(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    for (const key of SCENE_NODE_KEYS) {
        if (obj[key] && typeof obj[key] === 'object') {
            return { key, payload: obj[key] };
        }
    }
    return null;
}

function collectGeometries(node, polyBin, wireBin) {
    const uidMap = {};
    buildUidMap(node, uidMap);
    resolveRefs(node, uidMap);

    const results = [];
    const processed = new Map();
    const graphNodes = [];
    const graphRoots = [];
    const stats = { rig: 0, geom: 0, morph: 0, wire: 0, skip: 0, errors: [] };

    function addGraphNode(name, matrix, extra) {
        const idx = graphNodes.length;
        graphNodes.push({
            name: name || '',
            matrix: matrix || null,
            children: [],
            meshes: [],
            parent: -1,
            kind: extra && extra.kind,
            invBindMatrix: extra && extra.invBindMatrix,
            aliases: (extra && extra.aliases) || [],
        });
        return idx;
    }

    function attachMesh(parentIdx, geomIndex) {
        if (parentIdx >= 0 && geomIndex >= 0) {
            graphNodes[parentIdx].meshes.push(geomIndex);
        }
    }

    function finishGeometry(geom, label) {
        if (!geom) return -1;
        if (isWireframeGeom(geom)) {
            stats.wire++;
            return -1;
        }
        const uid = geom.UniqueID;
        const key = uid !== undefined ? 'id:' + uid : 'obj:' + (geom.Name || label || results.length);
        if (processed.has(key)) return processed.get(key);

        try {
            const result = processGeometry(geom, polyBin, wireBin);
            if (result.indices && result.attributes.POSITION) {
                const tcKeys = sortTexCoordKeys(
                    Object.keys(result.attributes).filter((k) => k.startsWith('_TC_'))
                );
                let tcIdx = 0;
                for (const k of tcKeys) {
                    result.attributes[`TEXCOORD_${tcIdx++}`] = result.attributes[k];
                    delete result.attributes[k];
                }
                const idx = results.length;
                results.push(result);
                processed.set(key, idx);
                return idx;
            }
            stats.skip++;
            processed.set(key, -1);
            return -1;
        } catch (e) {
            const msg = e && e.message ? e.message : String(e);
            stats.errors.push(`${geom.Name || label || '?'}: ${msg}`);
            console.warn(`  Warning: skipping ${geom.Name || label}: ${msg}`);
            processed.set(key, -1);
            return -1;
        }
    }

    /**
     * Walk the osg scene graph. Named glTF nodes come from MatrixTransform /
     * Node / Bone (and Skeleton so bones stay parented). Meshes attach to the
     * current parent; Rig/Morph still decode without baking verts.
     */
    function walk(obj, depth, parentIdx) {
        if (!obj || typeof obj !== 'object' || depth > 60) return;

        if (Array.isArray(obj)) {
            for (const item of obj) walk(item, depth + 1, parentIdx);
            return;
        }

        const scene = unwrapSceneNode(obj);
        if (scene) {
            const raw = scene.payload.Matrix;
            const matrix = (Array.isArray(raw) && raw.length === 16)
                ? raw.slice()
                : null;
            let extra;
            if (scene.key === 'osgAnimation.Bone') {
                const ibm = scene.payload.InvBindMatrixInSkeletonSpace;
                extra = {
                    kind: 'bone',
                    invBindMatrix: Array.isArray(ibm) && ibm.length === 16 ? ibm : null,
                };
            } else if (scene.key === 'osgAnimation.Skeleton') {
                extra = { kind: 'skeleton' };
            }
            const aliases = collectUpdateAliases(scene.payload);
            if (aliases.length) extra = Object.assign({ aliases }, extra || {});
            const idx = addGraphNode(scene.payload.Name, matrix, extra);
            if (parentIdx >= 0) {
                graphNodes[parentIdx].children.push(idx);
                graphNodes[idx].parent = parentIdx;
            } else {
                graphRoots.push(idx);
            }
            if (scene.payload.Children) walk(scene.payload.Children, depth + 1, idx);
            return;
        }

        if (obj['osgAnimation.RigGeometry'] || obj['osg.RigGeometry']) {
            const rig = obj['osgAnimation.RigGeometry'] || obj['osg.RigGeometry'];
            stats.rig++;
            const geom = extractMeshGeometry(rig);
            if (geom && rig.VertexAttributeList) {
                geom.VertexAttributeList = Object.assign(
                    {},
                    geom.VertexAttributeList || {},
                    rig.VertexAttributeList
                );
            }
            const geomIdx = finishGeometry(geom, 'RigGeometry');
            if (geomIdx >= 0 && rig.BoneMap && typeof rig.BoneMap === 'object') {
                results[geomIdx].boneMap = rig.BoneMap;
            }
            if (geomIdx >= 0) attachMorphTargets(results[geomIdx], rig, polyBin, wireBin);
            attachMesh(parentIdx, geomIdx);
            for (const [k, v] of Object.entries(rig)) {
                if (k === 'SourceGeometry') continue;
                walk(v, depth + 1, parentIdx);
            }
            for (const [k, v] of Object.entries(obj)) {
                if (k === 'osgAnimation.RigGeometry' || k === 'osg.RigGeometry') continue;
                walk(v, depth + 1, parentIdx);
            }
            return;
        }

        if (obj['osgAnimation.MorphGeometry'] || obj['osg.MorphGeometry']) {
            const morph = obj['osgAnimation.MorphGeometry'] || obj['osg.MorphGeometry'];
            stats.morph++;
            const geomIdx = finishGeometry(extractMeshGeometry(morph) || morph, 'MorphGeometry');
            if (geomIdx >= 0) attachMorphTargets(results[geomIdx], morph, polyBin, wireBin);
            attachMesh(parentIdx, geomIdx);
            for (const [k, v] of Object.entries(obj)) {
                if (k === 'osgAnimation.MorphGeometry' || k === 'osg.MorphGeometry') continue;
                walk(v, depth + 1, parentIdx);
            }
            for (const [k, v] of Object.entries(morph)) {
                if (k === 'SourceGeometry' || k === 'MorphTargets') continue;
                walk(v, depth + 1, parentIdx);
            }
            return;
        }

        if (obj['osg.Geometry']) {
            stats.geom++;
            attachMesh(parentIdx, finishGeometry(obj['osg.Geometry'], 'Geometry'));
            return;
        }

        for (const v of Object.values(obj)) {
            walk(v, depth + 1, parentIdx);
        }
    }

    walk(node, 0, -1);

    if (!results.length) {
        const errBits = [
            `rig=${stats.rig}`,
            `geom=${stats.geom}`,
            `morph=${stats.morph}`,
            `wire=${stats.wire}`,
            `skip=${stats.skip}`,
        ];
        if (stats.errors.length) {
            errBits.push('errors=' + stats.errors.slice(0, 3).join(' | '));
        }
        console.warn('collectGeometries: no meshes', errBits.join(', '));
    } else if (stats.skip > 0 || stats.errors.length > 0) {
        const bits = [`skip=${stats.skip}`, `errors=${stats.errors.length}`];
        if (stats.errors.length) {
            bits.push(stats.errors.slice(0, 3).join(' | '));
        }
        console.warn('collectGeometries: partial success,', bits.join(', '));
    }

    return { geometries: results, stats, graph: { nodes: graphNodes, roots: graphRoots } };
}


function packGlb(json, bin) {
  const j = JSON.parse(JSON.stringify(json));
  if (j.buffers && j.buffers[0]) delete j.buffers[0].uri;
  const jsonBytes = new TextEncoder().encode(JSON.stringify(j));
  const jsonPadded = pad4(jsonBytes, 0x20);
  const binPadded = pad4(bin, 0);
  const totalLen = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const glb = new Uint8Array(totalLen);
  const dv = new DataView(glb.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, totalLen, true);
  let o = 12;
  dv.setUint32(o, jsonPadded.length, true); o += 4;
  dv.setUint32(o, 0x4e4f534a, true); o += 4;
  glb.set(jsonPadded, o); o += jsonPadded.length;
  dv.setUint32(o, binPadded.length, true); o += 4;
  dv.setUint32(o, 0x004e4942, true); o += 4;
  glb.set(binPadded, o);
  return glb;
}

function indexTextureFiles(textureList) {
  const textureFiles = {};
  if (!textureList || !textureList.length) return textureFiles;
  for (const t of textureList) {
    const base = t.name.split('/').pop();
    const bare = textureBasename(base);
    textureFiles[base] = t.data;
    textureFiles[bare] = t.data;
    textureFiles[t.name] = t.data;
    textureFiles['textures/' + base] = t.data;
    textureFiles['textures/' + bare] = t.data;
    if (t.originalName) {
      textureFiles[t.originalName] = t.data;
      textureFiles['textures/' + t.originalName] = t.data;
    }
    const uidM = base.match(/^([a-f0-9]{32})_/i);
    if (uidM) textureFiles[uidM[1].toLowerCase()] = t.data;
    if (t.uid) textureFiles[String(t.uid).toLowerCase()] = t.data;
    const anyUid = t.name.match(/([a-f0-9]{32})/i);
    if (anyUid) textureFiles[anyUid[1].toLowerCase()] = t.data;
  }
  return textureFiles;
}

/**
 * Flip green channel of a normal map (Sketchfab NormalMap.flipY).
 * Uses OffscreenCanvas when available (Chrome extension SW / pages).
 */
async function flipNormalMapY(bytes) {
  if (typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    return bytes; // can't flip — leave as-is
  }
  try {
    const blob = new Blob([bytes]);
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i + 1] = 255 - d[i + 1];
    }
    ctx.putImageData(img, 0, 0);
    const outBlob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await outBlob.arrayBuffer());
  } catch (_) {
    return bytes;
  }
}

/**
 * Convert Sketchfab osgjs + bins (+ optional textures) to GLB (+ optional external glTF).
 * @param {Map|object|null} viewerMaterials - from parseViewerMaterials(info)
 */
async function convertOsgjsToGlb(osgjs, polyBin, wireBin, textureList, viewerMaterials = null, modelName = null, extraFiles = null, viewerScene = null) {
  const poly = polyBin instanceof Uint8Array
    ? polyBin.buffer.slice(polyBin.byteOffset, polyBin.byteOffset + polyBin.byteLength)
    : polyBin;
  const wire = !wireBin ? null
    : (wireBin instanceof Uint8Array
      ? wireBin.buffer.slice(wireBin.byteOffset, wireBin.byteOffset + wireBin.byteLength)
      : wireBin);

  const { geometries, stats, graph } = collectGeometries(osgjs, poly, wire);
  const osgAnimations = collectOsgAnimations(osgjs);
  const animFileMap = extraFiles || null;
  if (!geometries.length) {
    throw new Error(
      'No triangle geometries found in osgjs (checked osg.Geometry, RigGeometry.SourceGeometry, MorphGeometry)'
    );
  }

  // Pre-flip normal maps (Sketchfab NormalMap.flipY: true → OpenGL/glTF convention)
  const list = (textureList || []).map((t) => ({ ...t }));
  const needFlipUids = new Set();
  let flipAllNormals = true; // default: flip *_N maps for glTF
  if (viewerMaterials) {
    const vm = viewerMaterials instanceof Map ? viewerMaterials : new Map(Object.entries(viewerMaterials));
    let anySpec = false;
    for (const spec of vm.values()) {
      if (!spec) continue;
      anySpec = true;
      if (spec.normalFlipY && spec.normalUid) {
        needFlipUids.add(String(spec.normalUid).toLowerCase());
      }
    }
    // If materials say flipY explicitly for some, only flip those; else keep flipAllNormals
    if (anySpec && needFlipUids.size > 0) flipAllNormals = false;
  }
  for (const t of list) {
    const bare = textureBasename(t.name);
    const uids = [t.uid, ...(t.imageUids || [])].filter(Boolean).map((x) => String(x).toLowerCase());
    const nameIsNormal = /_n\.(png|jpe?g|webp)$/i.test(bare) || /normal/i.test(bare);
    const uidMatch = uids.some((u) => needFlipUids.has(u));
    const shouldFlip = uidMatch || (flipAllNormals && nameIsNormal);
    if (shouldFlip) {
      t._flipYData = await flipNormalMapY(t.data);
    }
  }

  const textureFiles = indexTextureFiles(list);
  // Register flipped normals under name.__flipY for addImage(..., {flipNormalY:true})
  for (const t of list) {
    if (t._flipYData) {
      const bare = textureBasename(t.name);
      textureFiles[t.name + '.__flipY'] = t._flipYData;
      textureFiles[bare + '.__flipY'] = t._flipYData;
      textureFiles['textures/' + bare + '.__flipY'] = t._flipYData;
      // also make flip path work when looking up by bare + '.__flipY'
      textureFiles[bare + '.__flipY'] = t._flipYData;
    }
  }

  const { global: textureMap, perGeom: perGeomMaps } = buildTextureMaps(
    geometries,
    list,
    textureFiles,
    viewerMaterials
  );

  // Opacity-only cards (hair dithering with no albedo): tint × opacity alpha.
  const tintDone = new Map();
  for (const map of perGeomMaps) {
    if (!map || map.skip || !map.opacityAsAlbedo || !map.alpha) continue;
    const tintKey =
      map.alpha +
      '|' +
      (map.baseColorFactor || []).join(',');
    if (tintDone.has(tintKey)) {
      map.albedo = tintDone.get(tintKey);
      map.baseColorFactor = [1, 1, 1, 1];
      continue;
    }
    const mHit = findTextureBytes(map.alpha, textureFiles);
    if (!mHit) continue;
    try {
      const baked = await bakeTintWithAlpha(map.baseColorFactor || [1, 1, 1, 1], mHit.data);
      if (!baked) continue;
      const bakedName =
        textureBasename(map.alpha).replace(/\.[^.]+$/, '') + '_tint.png';
      textureFiles[bakedName] = baked;
      textureFiles['textures/' + bakedName] = baked;
      list.push({ name: 'textures/' + bakedName, data: baked });
      tintDone.set(tintKey, bakedName);
      map.albedo = bakedName;
      map.baseColorFactor = [1, 1, 1, 1];
    } catch (_) {}
  }

  // glTF reads alpha from baseColorTexture.A. Bake only when albedo + opacity
  // share an atlas (alphaBlend / mask). Sketchfab "dithering" hair uses a
  // second atlas (Hair_M) on another UV — baking it into Hair_AO punches holes.
  const bakedDone = new Map();
  for (const map of perGeomMaps) {
    if (!map || map.skip || !map.albedo || !map.alpha || !map.opacityEnable) continue;
    if (/dither/i.test(String(map.opacityType || ''))) continue;
    const bakeKey = map.albedo + '|' + map.alpha;
    if (bakedDone.has(bakeKey)) {
      const prev = bakedDone.get(bakeKey);
      // null == the bake was fully opaque, so it was skipped
      if (prev) map.albedo = prev;
      else map.forceOpaque = true;
      continue;
    }
    const aHit = findTextureBytes(map.albedo, textureFiles);
    const mHit = findTextureBytes(map.alpha, textureFiles);
    if (!aHit || !mHit) continue;
    try {
      const baked = await bakeOpacityIntoAlbedo(aHit.data, mHit.data);
      if (!baked) continue;
      if (!baked.hasTransparency) {
        // Flat/opaque opacity map: keep the original albedo and export OPAQUE,
        // otherwise EEVEE renders a solid object see-through.
        bakedDone.set(bakeKey, null);
        map.forceOpaque = true;
        continue;
      }
      const bakedName =
        textureBasename(map.albedo).replace(/\.[^.]+$/, '') + '_alpha.png';
      textureFiles[bakedName] = baked.data;
      textureFiles['textures/' + bakedName] = baked.data;
      list.push({ name: 'textures/' + bakedName, data: baked.data });
      bakedDone.set(bakeKey, bakedName);
      map.albedo = bakedName;
    } catch (_) {}
  }

  // 1) Embedded GLB
  const animDebug = { clipsInOsgjs: osgAnimations.length, emitted: [], skips: [] };
  const embedded = buildGLTF(geometries, textureMap, textureFiles, perGeomMaps, {
    externalTextures: false,
    modelName,
    graph,
    osgAnimations,
    animFileMap,
    animDebug,
    viewerScene,
  });
  const glb = packGlb(embedded.json, embedded.bin);
  const textureEmbedCount =
    (embedded.json.images && embedded.json.images.length) || 0;

  // Count non-skipped meshes
  const meshCount = (embedded.json.meshes && embedded.json.meshes.length) || 0;

  // 2) External glTF
  const external = buildGLTF(geometries, textureMap, textureFiles, perGeomMaps, {
    externalTextures: true,
    modelName,
    graph,
    osgAnimations,
    animFileMap,
    viewerScene,
  });
  external.json.buffers = [
    {
      byteLength: external.bin.length,
      uri: 'model.bin',
    },
  ];
  const jsonText = new TextEncoder().encode(
    JSON.stringify(external.json, null, 2)
  );

  const textureAliases = [];
  const usedBare = new Set(
    (external.json.images || [])
      .map((im) => (im.uri || '').replace(/^textures\//, ''))
      .filter(Boolean)
  );
  for (const t of list) {
    const bare = textureBasename(t.name);
    if (usedBare.has(bare)) {
      textureAliases.push({ from: t.name, to: 'textures/' + bare, data: t.data });
    }
  }

  return {
    glb,
    geometryCount: meshCount || geometries.length,
    skipped: stats.skip,
    convertErrors: stats.errors.length,
    json: embedded.json,
    animDebug,
    textureEmbedCount,
    gltfExternal: {
      jsonText,
      bin: external.bin instanceof Uint8Array ? external.bin : new Uint8Array(external.bin),
      textureAliases,
    },
  };
}

export async function convertOsgjsToGlbFromFiles(fileMap, viewerMaterials = null, textureList = null, modelName = null, viewerScene = null) {
  // fileMap: { 'file.osgjs': text/bytes, 'model_file.bin': bytes, ... , textures/* }
  let osgjsRaw = fileMap['file.osgjs'];
  if (!osgjsRaw) throw new Error('file.osgjs missing');
  if (osgjsRaw instanceof Uint8Array) osgjsRaw = new TextDecoder().decode(osgjsRaw);
  const osgjs = typeof osgjsRaw === 'string' ? JSON.parse(osgjsRaw) : osgjsRaw;
  const poly = fileMap['model_file.bin'];
  if (!poly) throw new Error('model_file.bin missing');
  const wire = fileMap['model_file_wireframe.bin'] || null;
  const textures = [];
  if (Array.isArray(textureList)) {
    for (const t of textureList) {
      if (t && t.data) textures.push(t);
    }
  } else {
    for (const [name, data] of Object.entries(fileMap)) {
      if (name.startsWith('textures/') && data instanceof Uint8Array) {
        textures.push({ name, data });
      }
    }
  }
  return convertOsgjsToGlb(osgjs, poly, wire, textures, viewerMaterials, modelName, fileMap, viewerScene);
}
