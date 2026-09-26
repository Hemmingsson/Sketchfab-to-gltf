import { test } from "node:test";
import assert from "node:assert/strict";
import { triFanToTriangles, quadsToTriangles, sortTexCoordKeys } from "../src/lib/osgjs2gltf.js";

test("triFanToTriangles expands a fan around the first vertex", () => {
  assert.deepEqual([...triFanToTriangles([0, 1, 2, 3, 4])], [0, 1, 2, 0, 2, 3, 0, 3, 4]);
});

test("quadsToTriangles splits each quad into two triangles", () => {
  assert.deepEqual(
    [...quadsToTriangles([0, 1, 2, 3, 4, 5, 6, 7])],
    [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]
  );
});

test("degenerate inputs produce no triangles", () => {
  assert.deepEqual([...triFanToTriangles([0, 1])], []); // fewer than 3 verts
  assert.deepEqual([...quadsToTriangles([0, 1, 2])], []); // incomplete quad
});

test("sortTexCoordKeys orders _TC_* keys numerically, not lexically", () => {
  assert.deepEqual(
    sortTexCoordKeys(["_TC_10", "_TC_2", "_TC_0", "_TC_1"]),
    ["_TC_0", "_TC_1", "_TC_2", "_TC_10"]
  );
});
