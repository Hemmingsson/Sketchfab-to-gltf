import { test } from "node:test";
import assert from "node:assert/strict";
import { mat4Multiply, applyMatrixToVertices } from "../lib/osgjs2gltf.js";

// Column-major 4x4 with translation at indices 12,13,14.
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translate = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
// +90° about Z (column-major): x' = -y, y' = x.
const rotZ90 = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

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
  const scale2 = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1];
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
  const data = new Float32Array([1, 2, 3]);
  const res = { attributes: { POSITION: { data, itemSize: 3, count: 1 } } };
  applyMatrixToVertices(res, null);
  assert.deepEqual([...data], [1, 2, 3]);
});

test("two squares side by side no longer collapse to the same spot", () => {
  // Same local geometry (a unit square centered on its own origin), placed by
  // two different MatrixTransforms — the reported bug: without baking they
  // share a centroid; with baking their centroids separate by the offset.
  const square = () => new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
  const centroid = (d) => {
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < d.length; i += 3) { x += d[i]; y += d[i + 1]; z += d[i + 2]; }
    const n = d.length / 3;
    return [x / n, y / n, z / n];
  };
  const a = { attributes: { POSITION: { data: square(), itemSize: 3, count: 4 } } };
  const b = { attributes: { POSITION: { data: square(), itemSize: 3, count: 4 } } };
  applyMatrixToVertices(a, translate(-5, 0, 0));
  applyMatrixToVertices(b, translate(5, 0, 0));
  const ca = centroid(a.attributes.POSITION.data);
  const cb = centroid(b.attributes.POSITION.data);
  assert.ok(near(ca[0], -5) && near(cb[0], 5), `centroids ${ca} ${cb}`);
  assert.equal(cb[0] - ca[0], 10); // separated, not overlapping
});
