import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { convertOsgjsToGlbFromFiles } from "../lib/osgjs2gltf.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const samples = join(root, ".context/samples");

const near = (a, b, eps = 1e-5) => Math.abs(a - b) <= eps;

function packTriangleBins(basePos, targetPos) {
  const idx = new Uint16Array([0, 1, 2]);
  const base = new Float32Array(basePos);
  const target = new Float32Array(targetPos);
  const bin = new Uint8Array(16 + base.byteLength + target.byteLength);
  bin.set(new Uint8Array(idx.buffer), 0);
  bin.set(new Uint8Array(base.buffer), 16);
  bin.set(new Uint8Array(target.buffer), 16 + base.byteLength);
  return { bin, targetOffset: 16 + base.byteLength };
}

function triangleGeom(name, posOffset) {
  return {
    Name: name,
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
        Array: { Float32Array: { Size: 3, Offset: posOffset } },
      },
    },
  };
}

function packMorphTriangleOsgjs() {
  // Z-up: base (0,0,0) (1,0,0) (0,1,0); target moves first vertex to (0,2,0)
  const { bin, targetOffset } = packTriangleBins(
    [0, 0, 0, 1, 0, 0, 0, 1, 0],
    [0, 2, 0, 1, 0, 0, 0, 1, 0]
  );
  const base = triangleGeom("morph_base", 16);
  const target = {
    Name: "open_jaw",
    VertexAttributeList: {
      Vertex: {
        ItemSize: 3,
        Array: { Float32Array: { Size: 3, Offset: targetOffset } },
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
          "osgAnimation.MorphGeometry": {
            Name: "morph_base",
            PrimitiveSetList: base.PrimitiveSetList,
            VertexAttributeList: base.VertexAttributeList,
            MorphTargets: [{ "osg.Geometry": target }],
          },
        },
      ],
    },
  };
  const flat = {
    Generator: "test",
    Version: 9,
    "osg.Node": {
      Name: "scene",
      Children: [{ "osg.Geometry": base }],
    },
  };
  return { osgjs, flat, bin };
}

function readAccessorVec3(json, bin, accIdx) {
  const acc = json.accessors[accIdx];
  const bv = json.bufferViews[acc.bufferView];
  const offset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  return new Float32Array(bin.buffer, bin.byteOffset + offset, acc.count * 3);
}

function firstMorphedMesh(json) {
  for (const mesh of json.meshes || []) {
    const prim = mesh.primitives && mesh.primitives[0];
    if (prim && prim.targets && prim.targets.length) return { mesh, prim };
  }
  return null;
}

test("synthetic MorphGeometry emits Y-up POSITION delta and zero weights", async () => {
  const { osgjs, flat, bin } = packMorphTriangleOsgjs();
  const morphed = await convertOsgjsToGlbFromFiles({
    "file.osgjs": JSON.stringify(osgjs),
    "model_file.bin": bin,
  });
  const flattened = await convertOsgjsToGlbFromFiles({
    "file.osgjs": JSON.stringify(flat),
    "model_file.bin": bin,
  });

  const hit = firstMorphedMesh(morphed.json);
  assert.ok(hit, "mesh has primitive.targets");
  assert.equal(hit.prim.targets.length, 1);
  assert.ok(hit.prim.targets[0].POSITION !== undefined);
  assert.deepEqual(hit.mesh.weights, [0]);
  assert.equal(hit.mesh.extras.targetNames[0], "open_jaw");
  assert.ok(!morphed.json.animations || morphed.json.animations.length === 0);

  const basePos = readAccessorVec3(
    morphed.json,
    morphed.gltfExternal.bin,
    hit.prim.attributes.POSITION
  );
  const flatPrim = flattened.json.meshes[0].primitives[0];
  const flatPos = readAccessorVec3(
    flattened.json,
    flattened.gltfExternal.bin,
    flatPrim.attributes.POSITION
  );
  assert.equal(basePos.length, flatPos.length);
  for (let i = 0; i < basePos.length; i++) {
    assert.ok(near(basePos[i], flatPos[i]), `base[${i}] ${basePos[i]} vs flatten ${flatPos[i]}`);
  }

  // Z-up (0,2,0) − (0,0,0) after (x,y,z)→(x,z,-y) is (0,0,-2)
  const delta = readAccessorVec3(
    morphed.json,
    morphed.gltfExternal.bin,
    hit.prim.targets[0].POSITION
  );
  assert.ok(near(delta[0], 0) && near(delta[1], 0) && near(delta[2], -2));
  assert.ok(near(delta[3], 0) && near(delta[4], 0) && near(delta[5], 0));
  assert.ok(near(delta[6], 0) && near(delta[7], 0) && near(delta[8], 0));
});

test("RigGeometry wrapping MorphGeometry keeps skin attrs and morph targets", async () => {
  const { osgjs, bin } = packMorphTriangleOsgjs();
  const joints = new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const extra = new Uint8Array(bin.length + joints.byteLength + weights.byteLength);
  extra.set(bin, 0);
  extra.set(new Uint8Array(joints.buffer), bin.length);
  extra.set(new Uint8Array(weights.buffer), bin.length + joints.byteLength);
  const morph = osgjs["osg.Node"].Children[0]["osgAnimation.MorphGeometry"];
  const wrapped = {
    Generator: "test",
    Version: 9,
    "osg.Node": {
      Name: "scene",
      Children: [
        {
          "osgAnimation.Skeleton": {
            Name: "Skel",
            Children: [
              {
                "osgAnimation.Bone": {
                  Name: "BoneA",
                  Matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                  InvBindMatrixInSkeletonSpace: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                  Children: [
                    {
                      "osgAnimation.RigGeometry": {
                        BoneMap: { BoneA: 0 },
                        SourceGeometry: { "osgAnimation.MorphGeometry": morph },
                        VertexAttributeList: {
                          Bones: {
                            ItemSize: 4,
                            Array: { Uint16Array: { Size: 3, Offset: bin.length } },
                          },
                          Weights: {
                            ItemSize: 4,
                            Array: { Float32Array: { Size: 3, Offset: bin.length + joints.byteLength } },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  };

  const { json } = await convertOsgjsToGlbFromFiles({
    "file.osgjs": JSON.stringify(wrapped),
    "model_file.bin": extra,
  });
  const hit = firstMorphedMesh(json);
  assert.ok(hit, "wrapped morph still emits targets");
  assert.ok(hit.prim.attributes.JOINTS_0 !== undefined);
  assert.ok(hit.prim.attributes.WEIGHTS_0 !== undefined);
  assert.ok(json.skins && json.skins.length >= 1);
  assert.deepEqual(hit.mesh.weights, [0]);
});

test("chainsaw MorphGeometry export has targets and zero weights", async () => {
  const dir = join(samples, "Animated_Chainsaw_Low-Poly_Version-c04aed4a");
  const { json } = await convertOsgjsToGlbFromFiles({
    "file.osgjs": await readFile(join(dir, "file.osgjs"), "utf8"),
    "model_file.bin": new Uint8Array(await readFile(join(dir, "model_file.bin"))),
  });
  const hit = firstMorphedMesh(json);
  assert.ok(hit, "at least one mesh has targets");
  assert.ok(hit.prim.targets.length >= 1);
  assert.ok(hit.mesh.weights && hit.mesh.weights.length === hit.prim.targets.length);
  assert.ok(hit.mesh.weights.every((w) => w === 0));
  assert.ok(!json.animations || json.animations.length === 0);
});
