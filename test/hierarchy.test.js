import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  mat4Multiply,
  conjugateZupToYup,
  convertOsgjsToGlbFromFiles,
} from "../src/lib/osgjs2gltf.js";
import { needsSamples, samples } from "./samples.js";

const translate = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const near = (a, b, eps = 1e-5) => Math.abs(a - b) <= eps;

function packNestedTriangleOsgjs() {
  const idx = new Uint16Array([0, 1, 2]);
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const bin = new Uint8Array(16 + pos.byteLength);
  bin.set(new Uint8Array(idx.buffer), 0);
  bin.set(new Uint8Array(pos.buffer), 16);
  const geom = {
    Name: "tri",
    PrimitiveSetList: [
      {
        DrawElementsUShort: {
          Mode: "TRIANGLES",
          Indices: { Array: { Uint16Array: { Size: 3, Offset: 0 } } },
        },
      },
    ],
    VertexAttributeList: {
      Vertex: {
        ItemSize: 3,
        Array: { Float32Array: { Size: 3, Offset: 16 } },
      },
    },
  };
  const osgjs = {
    Generator: "test",
    Version: 9,
    "osg.Node": {
      Name: "scene",
      Children: [
        {
          "osg.MatrixTransform": {
            Name: "Parent",
            Matrix: translate(10, 0, 0),
            Children: [
              {
                "osg.MatrixTransform": {
                  Name: "Child",
                  Matrix: translate(0, 5, 0),
                  Children: [{ "osg.Geometry": geom }],
                },
              },
            ],
          },
        },
      ],
    },
  };
  return { osgjs, bin };
}

function readAccessorVec3(json, bin, accIdx) {
  const acc = json.accessors[accIdx];
  const bv = json.bufferViews[acc.bufferView];
  const offset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  return new Float32Array(bin.buffer, bin.byteOffset + offset, acc.count * 3);
}

function findParent(nodes, child) {
  for (let i = 0; i < nodes.length; i++) {
    if ((nodes[i].children || []).includes(child)) return i;
  }
  return -1;
}

function worldMatrixOf(nodes, idx) {
  const path = [];
  const seen = new Set();
  let i = idx;
  while (i >= 0 && !seen.has(i)) {
    seen.add(i);
    path.push(i);
    i = findParent(nodes, i);
  }
  path.reverse();
  let m = null;
  for (const n of path) m = mat4Multiply(m, nodes[n].matrix || null);
  return m;
}

function transformPoint(m, x, y, z) {
  if (!m) return [x, y, z];
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function bakeThenYup(m, x, y, z) {
  const [wx, wy, wz] = transformPoint(m, x, y, z);
  return [wx, wz, -wy];
}

function isFlatIdentityMeshSoup(json) {
  const roots = (json.scenes && json.scenes[0] && json.scenes[0].nodes) || [];
  if (roots.length !== 1) return false;
  const root = json.nodes[roots[0]];
  const kids = root.children || [];
  if (!kids.length) return true;
  return kids.every((i) => {
    const n = json.nodes[i];
    return n.mesh !== undefined && !(n.children && n.children.length) && !n.matrix;
  });
}

test("conjugateZupToYup maps a Z-up translation onto Y-up", () => {
  const m = conjugateZupToYup(translate(0, 5, 0));
  const p = transformPoint(m, 0, 0, 0);
  assert.ok(near(p[0], 0) && near(p[1], 0) && near(p[2], -5), `got ${p}`);
});

test("nested MatrixTransforms emit named nodes and local mesh verts", async () => {
  const { osgjs, bin } = packNestedTriangleOsgjs();
  const { json, gltfExternal } = await convertOsgjsToGlbFromFiles({
    "file.osgjs": JSON.stringify(osgjs),
    "model_file.bin": bin,
  });
  const names = json.nodes.map((n) => n.name).filter(Boolean);
  assert.ok(names.includes("Parent") && names.includes("Child"), `names ${names}`);
  assert.ok(names.includes("scene") || names.includes("Sketchfab_model"));

  const parent = json.nodes.find((n) => n.name === "Parent");
  const child = json.nodes.find((n) => n.name === "Child");
  assert.ok(parent && parent.children && parent.children.length, "Parent has children");
  assert.ok(child, "Child node exists");
  assert.equal(isFlatIdentityMeshSoup(json), false);

  const meshNode = json.nodes.find((n) => n.mesh !== undefined);
  assert.ok(meshNode, "a node carries the mesh");
  const prim = json.meshes[meshNode.mesh].primitives[0];
  const pos = readAccessorVec3(json, gltfExternal.bin, prim.attributes.POSITION);
  // Local (0,0,0) / (1,0,0) stay local after Y-up; not pre-multiplied by +10.
  assert.ok(near(pos[0], 0) && near(pos[1], 0) && near(pos[2], 0), `v0 ${[pos[0], pos[1], pos[2]]}`);
  assert.ok(near(pos[3], 1) && near(pos[4], 0) && near(pos[5], 0), `v1 ${[pos[3], pos[4], pos[5]]}`);
  assert.ok(
    Math.max(Math.abs(pos[0]), Math.abs(pos[3]), Math.abs(pos[6])) < 2,
    "POSITION is local, not world-baked"
  );

  const bakeM = mat4Multiply(translate(10, 0, 0), translate(0, 5, 0));
  const world = worldMatrixOf(json.nodes, json.nodes.indexOf(meshNode));
  for (let v = 0; v < 3; v++) {
    const lx = pos[v * 3], ly = pos[v * 3 + 1], lz = pos[v * 3 + 2];
    const composed = transformPoint(world, lx, ly, lz);
    const localZup = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ][v];
    const expected = bakeThenYup(bakeM, localZup[0], localZup[1], localZup[2]);
    assert.ok(
      near(composed[0], expected[0]) &&
        near(composed[1], expected[1]) &&
        near(composed[2], expected[2]),
      `v${v} composed ${composed} expected ${expected}`
    );
  }
});

test("Battle-Scarred soldier glTF is a node tree, not a flat mesh list", needsSamples, async () => {
  const dir = join(samples, "Battle-Scarred_Armored_Soldier-f5937af9");
  const fileMap = {
    "file.osgjs": await readFile(join(dir, "file.osgjs"), "utf8"),
    "model_file.bin": new Uint8Array(await readFile(join(dir, "model_file.bin"))),
  };
  const { json } = await convertOsgjsToGlbFromFiles(fileMap);
  assert.equal(isFlatIdentityMeshSoup(json), false);
  const namedParents = json.nodes.filter(
    (n) => n.name && n.children && n.children.length && n.mesh === undefined
  );
  assert.ok(namedParents.length >= 2, `expected nested named nodes, got ${namedParents.length}`);
  const withMatrix = json.nodes.filter((n) => n.matrix && n.matrix.length === 16);
  assert.ok(withMatrix.length >= 1, "at least one node carries a placement matrix");
});
