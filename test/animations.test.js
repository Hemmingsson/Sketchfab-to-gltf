import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANIM_CHANNEL_MODE,
  accumulateDeltaTimes,
  collapseNonIncreasing,
  timesLookLikeDeltas,
  collectAnimationBinGzNames,
  convertOsgjsToGlbFromFiles,
  decodePackedQuat,
  decodePackedVec3,
  deinterleavePlanar,
  dequantizePackedVec3,
  gunzipBytes,
  prefixSum,
  readOsgBufferArray,
  remapRotationYup,
  remapTranslationYup,
} from "../lib/osgjs2gltf.js";
import { extraAnimationUrls } from "../lib/pipeline.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const samples = join(root, ".context/samples");
const near = (a, b, eps = 1e-5) => Math.abs(a - b) <= eps;

function triangleGeom(posOffset) {
  return {
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
        Array: { Float32Array: { Size: 3, Offset: posOffset } },
      },
    },
  };
}

function packMeshBin() {
  const idx = new Uint16Array([0, 1, 2]);
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const bin = new Uint8Array(16 + pos.byteLength);
  bin.set(new Uint8Array(idx.buffer), 0);
  bin.set(new Uint8Array(pos.buffer), 16);
  return bin;
}

function floatBin(values, times) {
  const keys = new Float32Array(values);
  const t = new Float32Array(times);
  const bytes = new Uint8Array(keys.byteLength + t.byteLength);
  bytes.set(new Uint8Array(keys.buffer), 0);
  bytes.set(new Uint8Array(t.buffer), keys.byteLength);
  return { bytes, keyOffset: 0, timeOffset: keys.byteLength, keySize: keys.length / (values.length / times.length), timeSize: t.length };
}

test("collectAnimationBinGzNames returns unique hashes from osgjs", async () => {
  const snakes = await readFile(
    join(samples, "Animated_snakes_pack-88d57c4b/file.osgjs"),
    "utf8"
  );
  const names = collectAnimationBinGzNames(snakes);
  assert.ok(names.includes("8634bc4dc73c463e82e8397a4a7aa8a7.bin.gz"));
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.length >= 1);

  const door = await readFile(join(samples, "BulkHead_Door-95ba8c1b/file.osgjs"), "utf8");
  assert.deepEqual(collectAnimationBinGzNames(door), []);
});

test("gunzip + Float32 Key/Time decode", async () => {
  const keys = new Float32Array([1, 2, 3, 4, 5, 6]);
  const times = new Float32Array([0, 1]);
  const raw = new Uint8Array(keys.byteLength + times.byteLength);
  raw.set(new Uint8Array(keys.buffer), 0);
  raw.set(new Uint8Array(times.buffer), keys.byteLength);
  const unzipped = await gunzipBytes(gzipSync(raw));
  const keyOut = readOsgBufferArray(
    unzipped,
    { Offset: 0, Size: 2, ItemSize: 3 },
    "Float32Array"
  );
  const timeOut = readOsgBufferArray(
    unzipped,
    { Offset: keys.byteLength, Size: 2, ItemSize: 1 },
    "Float32Array"
  );
  assert.deepEqual([...keyOut], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...timeOut], [0, 1]);
});

test("CompressedPacked Vec3 dequant is origin + bbox + q*step", () => {
  const encoded = new Uint16Array([0, 10, 100]);
  const out = dequantizePackedVec3(encoded, {
    ox: 1, oy: 2, oz: 3,
    bx: 0.5, by: -0.25, bz: 0,
    hx: 0.1, hy: 0.01, hz: 0.001,
  });
  assert.ok(near(out[0], 1 + 0.5 + 0 * 0.1));
  assert.ok(near(out[1], 2 + -0.25 + 10 * 0.01));
  assert.ok(near(out[2], 3 + 0 + 100 * 0.001));
});

test("timesLookLikeDeltas distinguishes absolute vs delta packed times", () => {
  assert.equal(timesLookLikeDeltas(new Float32Array([0, 0.0165, 0.033, 8.667])), false);
  assert.equal(timesLookLikeDeltas(new Float32Array([0.033, 0.00033, 0.03333, 0.00033])), true);
  assert.equal(timesLookLikeDeltas(new Float32Array([0, 1])), false);
});

test("CompressedPacked times are deltas from ot, then strictly increasing", () => {
  const acc = accumulateDeltaTimes(new Float32Array([0.033, 0.000333, 0.033333, 0.000333]), 0);
  assert.ok(near(acc[0], 0.033));
  assert.ok(near(acc[1], 0.033333));
  assert.ok(near(acc[2], 0.066666));
  assert.ok(near(acc[3], 0.066999));
  const collapsed = collapseNonIncreasing(
    new Float32Array([0, 0.1, 0.1, 0.2]),
    new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    3
  );
  assert.equal(collapsed.times.length, 3);
  assert.ok(near(collapsed.times[0], 0) && near(collapsed.times[1], 0.1) && near(collapsed.times[2], 0.2));
  assert.ok(near(collapsed.values[3], 7));
});

test("packed identity (S=0, x=nphi/2, angle=0) is [0,0,0,1]; ORIGIN_KEY prepends rest", () => {
  const origin = {
    ox: -0.0375647,
    oy: -0.0375647,
    oz: -0.706108,
    ow: 0.706109,
    nphi: 7200,
    epsilon: 0.025,
  };
  const ident = decodePackedQuat(new Uint16Array([0, 3600, 0]), origin);
  assert.equal(ident.length, 4);
  assert.ok(near(ident[0], 0) && near(ident[1], 0) && near(ident[2], 0) && near(ident[3], 1));

  const composed = decodePackedQuat(new Uint16Array([0, 3600, 0]), {
    ...origin,
    channel_mode: ANIM_CHANNEL_MODE.ORIGIN_KEY | ANIM_CHANNEL_MODE.QUAT_OCT,
  });
  assert.equal(composed.length, 8);
  const n = Math.hypot(composed[0], composed[1], composed[2], composed[3]);
  assert.ok(near(n, 1, 1e-5));
  assert.ok(near(composed[0], origin.ox, 1e-4));
  assert.ok(near(composed[1], origin.oy, 1e-4));
  assert.ok(near(composed[2], origin.oz, 1e-4));
  assert.ok(near(composed[3], origin.ow, 1e-4));
  assert.ok(near(composed[4], origin.ox, 1e-4));
  assert.ok(near(composed[7], origin.ow, 1e-4));
});

test("packed times with TIME_DELTA prepend ot and prefix-sum", () => {
  const deltas = new Float32Array([0.033, 0.00033, 0.03333]);
  const times = new Float32Array(deltas.length + 1);
  times[0] = 0;
  times.set(deltas, 1);
  prefixSum(times, 1);
  assert.ok(near(times[0], 0));
  assert.ok(near(times[1], 0.033));
  assert.ok(near(times[times.length - 1], 0.06666, 1e-4));
  assert.deepEqual([...deinterleavePlanar([1, 2, 10, 20, 100, 200], 3)], [1, 10, 100, 2, 20, 200]);
});

test("packed vec3 ORIGIN_KEY+BBOX prepends origin then accumulates deltas", () => {
  const out = decodePackedVec3(new Uint16Array([0, 0, 0]), {
    channel_mode: ANIM_CHANNEL_MODE.BBOX | ANIM_CHANNEL_MODE.ORIGIN_KEY,
    ox: 1, oy: 2, oz: 74,
    bx: 0.5, by: 0, bz: -0.1,
    hx: 0.1, hy: 0.01, hz: 0.001,
  });
  assert.equal(out.length, 6);
  assert.ok(near(out[0], 1) && near(out[1], 2) && near(out[2], 74));
  assert.ok(near(out[3], 1 + 0.5) && near(out[4], 2) && near(out[5], 74 - 0.1));
});

test("Y-up remaps translation and rotation like conjugateZupToYup", () => {
  const t = remapTranslationYup(0, 5, 0);
  assert.ok(near(t[0], 0) && near(t[1], 0) && near(t[2], -5));
  const identity = remapRotationYup([0, 0, 0, 1]);
  // qR * I * qR⁻¹ = qR * qR⁻¹ = I
  assert.ok(near(identity[0], 0) && near(identity[1], 0) && near(identity[2], 0) && near(identity[3], 1));
  // 90° about Z (z-up) → 90° about Y (y-up)
  const qz = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const qy = remapRotationYup(qz);
  assert.ok(near(qy[0], 0) && near(qy[1], Math.SQRT1_2) && near(qy[2], 0) && near(qy[3], Math.SQRT1_2));
});

test("pipeline extraAnimationUrls uses /animations/ next to /files/, not the file.binz sibling", async () => {
  const osgjsUrl =
    "https://media.sketchfab.com/models/uid/ver/files/filehash/file.binz?token=abc";
  const snakes = await readFile(
    join(samples, "Animated_snakes_pack-88d57c4b/file.osgjs"),
    "utf8"
  );
  const urls = extraAnimationUrls(osgjsUrl, snakes);
  assert.ok(
    urls.every((u) =>
      u.startsWith("https://media.sketchfab.com/models/uid/ver/animations/")
    )
  );
  assert.ok(urls.every((u) => u.endsWith("?token=abc")));
  assert.ok(urls.every((u) => !u.includes("/files/")));
  assert.ok(urls.some((u) => u.includes("8634bc4dc73c463e82e8397a4a7aa8a7.bin.gz")));
  assert.deepEqual(extraAnimationUrls(osgjsUrl, '{"osg.Node":{}}'), []);
});

test("synthetic Vec3 translate clip targets the named node", async () => {
  const meshBin = packMeshBin();
  const anim = floatBin([0, 5, 0, 0, 5, 0], [0, 1]);
  const osgjs = {
    Generator: "test",
    Version: 9,
    "osg.Node": {
      Name: "scene",
      Children: [
        {
          "osg.MatrixTransform": {
            Name: "BoneA",
            Matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            Children: [{ "osg.Geometry": triangleGeom(16) }],
          },
        },
      ],
      UpdateCallbacks: [
        {
          "osgAnimation.BasicAnimationManager": {
            Animations: [
              {
                "osgAnimation.Animation": {
                  Name: "Take 001",
                  Channels: [
                    {
                      "osgAnimation.Vec3LerpChannel": {
                        Name: "translate",
                        TargetName: "BoneA",
                        KeyFrames: {
                          Key: {
                            Array: {
                              Float32Array: {
                                File: "clip.bin.gz",
                                Size: 2,
                                Offset: anim.keyOffset,
                              },
                            },
                            ItemSize: 3,
                          },
                          Time: {
                            Array: {
                              Float32Array: {
                                File: "clip.bin.gz",
                                Size: 2,
                                Offset: anim.timeOffset,
                              },
                            },
                            ItemSize: 1,
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
    "file.osgjs": JSON.stringify(osgjs),
    "model_file.bin": meshBin,
    "clip.bin.gz": anim.bytes,
  });
  assert.ok(json.animations && json.animations.length === 1);
  assert.equal(json.animations[0].name, "Take 001");
  assert.equal(json.animations[0].channels.length, 1);
  const ch = json.animations[0].channels[0];
  assert.equal(ch.target.path, "translation");
  assert.equal(json.nodes[ch.target.node].name, "BoneA");
});

test("animation TargetName matches UpdateBone alias, not only Bone.Name", async () => {
  const meshBin = packMeshBin();
  const anim = floatBin([0, 0, 0, 1, 2, 3], [0, 1]);
  const osgjs = {
    Generator: "test",
    Version: 9,
    "osg.Node": {
      Name: "scene",
      Children: [
        {
          "osgAnimation.Bone": {
            Name: "Bip01 L Toe0Nub_09",
            Matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            UpdateCallbacks: [
              { "osgAnimation.UpdateBone": { Name: "Bip01 L Toe0Nub_0" } },
            ],
            Children: [{ "osg.Geometry": triangleGeom(16) }],
          },
        },
      ],
      UpdateCallbacks: [
        {
          "osgAnimation.BasicAnimationManager": {
            Animations: [
              {
                "osgAnimation.Animation": {
                  Name: "motion4",
                  Channels: [
                    {
                      "osgAnimation.Vec3LerpChannel": {
                        Name: "translate",
                        TargetName: "Bip01 L Toe0Nub_0",
                        KeyFrames: {
                          Key: {
                            Array: {
                              Float32Array: {
                                File: "clip.bin.gz",
                                Size: 2,
                                Offset: anim.keyOffset,
                              },
                            },
                            ItemSize: 3,
                          },
                          Time: {
                            Array: {
                              Float32Array: {
                                File: "clip.bin.gz",
                                Size: 2,
                                Offset: anim.timeOffset,
                              },
                            },
                            ItemSize: 1,
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
    "file.osgjs": JSON.stringify(osgjs),
    "model_file.bin": meshBin,
    "clip.bin.gz": anim.bytes,
  });
  assert.equal(json.animations.length, 1);
  const node = json.nodes[json.animations[0].channels[0].target.node];
  assert.equal(node.name, "Bip01 L Toe0Nub_09");
  assert.deepEqual(node.extras.osgUpdateNames, ["Bip01 L Toe0Nub_0"]);
});

test("synthetic FloatLerpChannel emits weights on the morph mesh node", async () => {
  const meshBin = packMeshBin();
  const targetPos = new Float32Array([0, 2, 0, 1, 0, 0, 0, 1, 0]);
  const extra = new Uint8Array(meshBin.length + targetPos.byteLength);
  extra.set(meshBin, 0);
  extra.set(new Uint8Array(targetPos.buffer), meshBin.length);
  const anim = floatBin([0, 1], [0, 1]);
  const base = triangleGeom(16);
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
            MorphTargets: [
              {
                "osg.Geometry": {
                  Name: "open_jaw",
                  VertexAttributeList: {
                    Vertex: {
                      ItemSize: 3,
                      Array: { Float32Array: { Size: 3, Offset: meshBin.length } },
                    },
                  },
                },
              },
            ],
          },
        },
      ],
      UpdateCallbacks: [
        {
          "osgAnimation.BasicAnimationManager": {
            Animations: [
              {
                "osgAnimation.Animation": {
                  Name: "Key.001Action",
                  Channels: [
                    {
                      "osgAnimation.FloatLerpChannel": {
                        Name: "0",
                        TargetName: "open_jaw",
                        KeyFrames: {
                          Key: {
                            Array: {
                              Float32Array: {
                                File: "morph.bin.gz",
                                Size: 2,
                                Offset: anim.keyOffset,
                              },
                            },
                            ItemSize: 1,
                          },
                          Time: {
                            Array: {
                              Float32Array: {
                                File: "morph.bin.gz",
                                Size: 2,
                                Offset: anim.timeOffset,
                              },
                            },
                            ItemSize: 1,
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
    "file.osgjs": JSON.stringify(osgjs),
    "model_file.bin": extra,
    "morph.bin.gz": anim.bytes,
  });
  assert.equal(json.animations[0].name, "Key.001Action");
  const ch = json.animations[0].channels[0];
  assert.equal(ch.target.path, "weights");
  const node = json.nodes[ch.target.node];
  const mesh = json.meshes[node.mesh];
  assert.ok(mesh.weights && mesh.weights.length === 1);
  assert.equal(mesh.extras.targetNames[0], "open_jaw");
});

test("static hierarchy fixture has no animations[] and still converts", async () => {
  const meshBin = packMeshBin();
  const osgjs = {
    Generator: "test",
    Version: 9,
    "osg.Node": {
      Name: "scene",
      Children: [
        {
          "osg.MatrixTransform": {
            Name: "Parent",
            Matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1],
            Children: [{ "osg.Geometry": triangleGeom(16) }],
          },
        },
      ],
    },
  };
  const { json } = await convertOsgjsToGlbFromFiles({
    "file.osgjs": JSON.stringify(osgjs),
    "model_file.bin": meshBin,
  });
  assert.ok(!json.animations || json.animations.length === 0);
  assert.ok(json.meshes.length >= 1);
});

test("BulkHead_Door osgjs lists no animation bins", async () => {
  const door = await readFile(join(samples, "BulkHead_Door-95ba8c1b/file.osgjs"), "utf8");
  assert.deepEqual(collectAnimationBinGzNames(door), []);
  assert.deepEqual(
    extraAnimationUrls("https://cdn.example/file.binz", door),
    []
  );
});
