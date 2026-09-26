import { test } from "node:test";
import assert from "node:assert/strict";
import { mat4Multiply, applyMatrixToVertices, normalFromMat4, det3 } from "../src/lib/osgjs2gltf.js";

// Column-major 4x4 with translation at indices 12,13,14.
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translate = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
// +90° about Z (column-major): x' = -y, y' = x.
const rotZ90 = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// scale.x = -1: a mirror, det3 < 0 (should reverse winding).
const mirrorX = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const scale2 = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1];

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test("mat4Multiply: identity is a no-op", () => {
  assert.deepEqual(mat4Multiply(identity, translate(1, 2, 3)), translate(1, 2, 3));
  assert.deepEqual(mat4Multiply(translate(1, 2, 3), identity), translate(1, 2, 3));
});

test("mat4Multiply: null operand treated as identity", () => {
  assert.deepEqual(mat4Multiply(null, translate(4, 5, 6)), translate(4, 5, 6));
  assert.deepEqual(mat4Multiply(translate(4, 5, 6), null), translate(4, 5, 6));
});

test("mat4Multiply: composing two translations adds them", () => {
  const m = mat4Multiply(translate(1, 2, 3), translate(10, 20, 30));
  assert.deepEqual([m[12], m[13], m[14]], [11, 22, 33]);
});

test("mat4Multiply: parent∘child applies child first (rotate then translate)", () => {
  // parent = translate(5,0,0), child = rotZ90. A local +X point (1,0,0):
  // child rotates it to (0,1,0), then parent translates to (5,1,0).
  const m = mat4Multiply(translate(5, 0, 0), rotZ90);
  const res = { attributes: { POSITION: { data: new Float32Array([1, 0, 0]), itemSize: 3, count: 1 } } };
  applyMatrixToVertices(res, m);
  const p = res.attributes.POSITION.data;
  assert.ok(near(p[0], 5) && near(p[1], 1) && near(p[2], 0), `got ${[...p]}`);
});

test("applyMatrixToVertices: translation offsets POSITION but not NORMAL", () => {
  const res = {
    attributes: {
      POSITION: { data: new Float32Array([1, 1, 1]), itemSize: 3, count: 1 },
      NORMAL: { data: new Float32Array([0, 0, 1]), itemSize: 3, count: 1 },
    },
  };
  applyMatrixToVertices(res, translate(10, 20, 30));
  assert.deepEqual([...res.attributes.POSITION.data], [11, 21, 31]);
  assert.deepEqual([...res.attributes.NORMAL.data], [0, 0, 1]); // translation ignored
});

test("applyMatrixToVertices: rotation rotates both POSITION and NORMAL", () => {
  const res = {
    attributes: {
      POSITION: { data: new Float32Array([1, 0, 0]), itemSize: 3, count: 1 },
      NORMAL: { data: new Float32Array([1, 0, 0]), itemSize: 3, count: 1 },
    },
  };
  applyMatrixToVertices(res, rotZ90);
  const p = res.attributes.POSITION.data, n = res.attributes.NORMAL.data;
  assert.ok(near(p[0], 0) && near(p[1], 1), `pos ${[...p]}`);
  assert.ok(near(n[0], 0) && near(n[1], 1), `nrm ${[...n]}`);
});

test("applyMatrixToVertices: NORMAL renormalized under scale; TANGENT w preserved", () => {
  const res = {
    attributes: {
      NORMAL: { data: new Float32Array([1, 0, 0]), itemSize: 3, count: 1 },
      TANGENT: { data: new Float32Array([1, 0, 0, -1]), itemSize: 4, count: 1 },
    },
  };
  applyMatrixToVertices(res, scale2);
  assert.ok(near(Math.hypot(...res.attributes.NORMAL.data), 1));
  assert.equal(res.attributes.TANGENT.data[3], -1); // handedness (w) untouched
});

test("applyMatrixToVertices: null matrix is a no-op", () => {
  const res = {
    indices: new Uint32Array([0, 1, 2]),
    attributes: { POSITION: { data: new Float32Array([1, 2, 3]), itemSize: 3, count: 1 } },
  };
  applyMatrixToVertices(res, null);
  assert.deepEqual([...res.attributes.POSITION.data], [1, 2, 3]);
  assert.deepEqual([...res.indices], [0, 1, 2]);
});

test("det3: sign and magnitude of the upper-left 3x3", () => {
  assert.ok(det3(mirrorX) < 0, "a mirror has negative determinant");
  assert.equal(det3(identity), 1);
  assert.equal(det3(scale2), 8); // 2 * 2 * 2
});

test("normalFromMat4: rotation transforms +x to +y; singular returns null", () => {
  const m3 = normalFromMat4(rotZ90);
  // apply mat3 (column-major) to (1,0,0): column 0.
  assert.ok(near(m3[0], 0) && near(m3[1], 1) && near(m3[2], 0), `got ${m3 && [...m3]}`);
  const singular = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
  assert.equal(normalFromMat4(singular), null);
});

test("applyMatrixToVertices: mirror flips POSITION.x, keeps TANGENT.w, reverses winding", () => {
  const res = {
    indices: new Uint32Array([0, 1, 2]),
    attributes: {
      POSITION: { data: new Float32Array([1, 2, 3]), itemSize: 3, count: 1 },
      TANGENT: { data: new Float32Array([1, 0, 0, 1]), itemSize: 4, count: 1 },
    },
  };
  applyMatrixToVertices(res, mirrorX);
  const p = res.attributes.POSITION.data;
  assert.ok(near(p[0], -1) && near(p[1], 2) && near(p[2], 3), `pos ${[...p]}`);
  assert.equal(res.attributes.TANGENT.data[3], 1, "handedness (w) must not flip");
  assert.deepEqual([...res.indices], [2, 1, 0], "winding reversed on negative det");
});

test("applyMatrixToVertices: non-uniform scale uses inverse-transpose, not raw 3x3", () => {
  // diag(2,1,1) with an off-axis normal is the case that distinguishes the fix:
  // raw 3x3      → normalize(2,1,0) = (0.894, 0.447, 0)
  // inv-transpose→ normalize(0.5,1,0) = (0.447, 0.894, 0)  ← correct
  const nonUniform = [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const inv = 1 / Math.SQRT2;
  const res = { attributes: { NORMAL: { data: new Float32Array([inv, inv, 0]), itemSize: 3, count: 1 } } };
  applyMatrixToVertices(res, nonUniform);
  const n = res.attributes.NORMAL.data;
  assert.ok(near(Math.hypot(...n), 1, 1e-5), `not unit: ${[...n]}`);
  assert.ok(
    near(n[0], 0.4472136, 1e-4) && near(n[1], 0.8944272, 1e-4) && near(n[2], 0, 1e-4),
    `expected inverse-transpose (0.447,0.894,0), got ${[...n]}`
  );
});

test("applyMatrixToVertices: singular matrix leaves NORMAL finite (no NaN)", () => {
  const singular = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
  const res = {
    attributes: {
      POSITION: { data: new Float32Array([1, 2, 3]), itemSize: 3, count: 1 },
      NORMAL: { data: new Float32Array([0, 0, 1]), itemSize: 3, count: 1 },
    },
  };
  applyMatrixToVertices(res, singular);
  const n = res.attributes.NORMAL.data;
  assert.ok(n.every(Number.isFinite), `NORMAL must stay finite: ${[...n]}`);
});

test("applyMatrixToVertices: positive determinant does not reverse winding", () => {
  const a = {
    indices: new Uint32Array([0, 1, 2]),
    attributes: { POSITION: { data: new Float32Array([1, 1, 1]), itemSize: 3, count: 1 } },
  };
  applyMatrixToVertices(a, scale2);
  assert.deepEqual([...a.indices], [0, 1, 2], "scale2 (det > 0) keeps winding");

  const b = {
    indices: new Uint32Array([0, 1, 2]),
    attributes: { POSITION: { data: new Float32Array([1, 1, 1]), itemSize: 3, count: 1 } },
  };
  applyMatrixToVertices(b, translate(5, 0, 0));
  assert.deepEqual([...b.indices], [0, 1, 2], "translation keeps winding");
});
