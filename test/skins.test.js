import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  convertOsgjsToGlbFromFiles,
} from "../src/lib/osgjs2gltf.js";
import { needsSamples, samples } from "./samples.js";

const translate = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const near = (a, b, eps = 1e-5) => Math.abs(a - b) <= eps;

function packRigTriangleOsgjs() {
  const idx = new Uint16Array([0, 1, 2]);
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const joints = new Uint16Array([0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]);
  const weights = new Float32Array([0.6, 0.4, 0, 0, 1, 0, 0, 0, 0.25, 0.25, 0.25, 0.25]);
  const bin = new Uint8Array(160);
  bin.set(new Uint8Array(idx.buffer), 0);
  bin.set(new Uint8Array(pos.buffer), 16);
  bin.set(new Uint8Array(joints.buffer), 64);
  bin.set(new Uint8Array(weights.buffer), 96);

  const geom = {
    Name: "skinned_tri",
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
          "osgAnimation.Skeleton": {
            Name: "Skel",
            Children: [
              {
                "osg.Node": {
                  Name: "NotAJoint",
                  Children: [
                    {
                      "osgAnimation.RigGeometry": {
                        BoneMap: { BoneA: 0, BoneB: 1 },
                        SourceGeometry: { "osg.Geometry": geom },
                        VertexAttributeList: {
                          Bones: {
                            ItemSize: 4,
                            Array: { Uint16Array: { Size: 3, Offset: 64 } },
                          },
                          Weights: {
                            ItemSize: 4,
                            Array: { Float32Array: { Size: 3, Offset: 96 } },
                          },
                        },
                      },
                    },
                  ],
                },
              },
              {
                "osgAnimation.Bone": {
                  Name: "BoneA",
                  Matrix: identity,
                  InvBindMatrixInSkeletonSpace: identity.slice(),
                  Children: [
                    {
                      "osgAnimation.Bone": {
                        Name: "BoneB",
                        Matrix: translate(0, 5, 0),
                        InvBindMatrixInSkeletonSpace: translate(0, 5, 0),
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
  return { osgjs, bin };
}

function readAccessor(json, bin, accIdx) {
  const acc = json.accessors[accIdx];
  const bv = json.bufferViews[acc.bufferView];
  const offset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const view = bin.buffer.slice(bin.byteOffset + offset);
  if (acc.componentType === 5123) return new Uint16Array(view, 0, acc.count * 4);
  if (acc.type === "MAT4") return new Float32Array(view, 0, acc.count * 16);
  if (acc.type === "VEC3") return new Float32Array(view, 0, acc.count * 3);
  return new Float32Array(view, 0, acc.count * 4);
}

function firstSkinnedPrim(json) {
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      if (prim.attributes && prim.attributes.JOINTS_0 !== undefined && prim.attributes.WEIGHTS_0 !== undefined) {
        return prim;
      }
    }
  }
  return null;
}

test("synthetic RigGeometry emits skin, JOINTS_0/WEIGHTS_0, and raw IBMs", async () => {
  const { osgjs, bin } = packRigTriangleOsgjs();
  const { json, gltfExternal } = await convertOsgjsToGlbFromFiles({
    "file.osgjs": JSON.stringify(osgjs),
    "model_file.bin": bin,
  });

  assert.ok(json.skins && json.skins.length >= 1, "skins[0] exists");
  const skin = json.skins[0];
  assert.equal(skin.joints.length, 2);

  const jointNames = skin.joints.map((i) => json.nodes[i] && json.nodes[i].name);
  assert.deepEqual(jointNames, ["BoneA", "BoneB"]);
  assert.ok(!jointNames.includes("NotAJoint"));

  const prim = firstSkinnedPrim(json);
  assert.ok(prim, "a primitive has JOINTS_0 and WEIGHTS_0");
  assert.ok(prim.attributes.POSITION !== undefined);

  const joints = readAccessor(json, gltfExternal.bin, prim.attributes.JOINTS_0);
  const weights = readAccessor(json, gltfExternal.bin, prim.attributes.WEIGHTS_0);
  assert.equal(joints[0], 0);
  assert.equal(joints[1], 1);
  assert.ok(near(weights[0], 0.6) && near(weights[1], 0.4));

  const ibmAcc = json.accessors[skin.inverseBindMatrices];
  assert.equal(ibmAcc.count, 2);
  assert.equal(ibmAcc.type, "MAT4");
  assert.equal(ibmAcc.min, undefined);
  assert.equal(ibmAcc.max, undefined);
  const ibm = readAccessor(json, gltfExternal.bin, skin.inverseBindMatrices);
  for (let i = 0; i < 16; i++) {
    assert.ok(near(ibm[i], identity[i]), `identity IBM[${i}] ${ibm[i]}`);
  }
  const expectedB = translate(0, 5, 0);
  for (let i = 0; i < 16; i++) {
    assert.ok(near(ibm[16 + i], expectedB[i]), `translated IBM[${i}] ${ibm[16 + i]} vs ${expectedB[i]}`);
  }

  const skelNode = json.nodes[skin.skeleton];
  assert.ok(skelNode && skelNode.name === "Skel", "skeleton node exists");

  const meshNode = json.nodes.find((n) => n.mesh !== undefined && n.skin === 0);
  assert.ok(meshNode, "mesh node references the skin");
});

test("Finger_on_a_board_Animated export has skins and bind-pose POSITION", needsSamples, async () => {
  const dir = join(samples, "Finger_on_a_board_Animated-c39e9217");
  const osgjsText = await readFile(join(dir, "file.osgjs"), "utf8");
  const osgjs = JSON.parse(osgjsText);
  const boneMaps = [];
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.BoneMap) boneMaps.push(n.BoneMap);
    for (const v of Object.values(n)) walk(v);
  })(osgjs);
  assert.ok(boneMaps.length, "sample has BoneMap");
  const boneMapSize = Object.keys(boneMaps[0]).length;

  const { json } = await convertOsgjsToGlbFromFiles({
    "file.osgjs": osgjsText,
    "model_file.bin": new Uint8Array(await readFile(join(dir, "model_file.bin"))),
  });

  assert.ok(json.skins && json.skins.length >= 1, `skins ${json.skins && json.skins.length}`);
  const prim = firstSkinnedPrim(json);
  assert.ok(prim, "JOINTS_0 and WEIGHTS_0 on a primitive");
  assert.ok(prim.attributes.POSITION !== undefined, "bind-pose POSITION present");

  const skin = json.skins[0];
  assert.equal(skin.joints.length, boneMapSize);
  assert.ok(skin.skeleton !== undefined && json.nodes[skin.skeleton], "skeleton node exists");
  const ibmAcc = json.accessors[skin.inverseBindMatrices];
  assert.equal(ibmAcc.count, boneMapSize);

  const jointNodes = skin.joints.map((i) => json.nodes[i]);
  assert.ok(jointNodes.every((n) => n && n.name), "joints are named bone nodes");
  for (const name of Object.keys(boneMaps[0])) {
    assert.ok(jointNodes.some((n) => n.name === name), `joint ${name}`);
  }
});
