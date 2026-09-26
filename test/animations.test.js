import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import {
  ANIM_CHANNEL_MODE,
  collapseNonIncreasing,
  collectAnimationBinGzNames,
  convertOsgjsToGlbFromFiles,
  decodePackedQuat,
  decodePackedVec3,
  deinterleavePlanar,
  dequantizePackedVec3,
  gunzipBytes,
  prefixSum,
  readBufferArray,
  remapRotationYup,
  remapTranslationYup,
} from "../src/lib/osgjs2gltf.js";
import { extraAnimationUrls } from "../src/lib/pipeline.js";
import { needsSamples, samples } from "./samples.js";

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
  return { bytes, keyOffset: 0, timeOffset: keys.byteLength, timeSize: t.length };
}

function keyframes(file, anim, itemSize) {
  const arr = (offset) => ({
    Array: { Float32Array: { File: file, Size: anim.timeSize, Offset: offset } },
    ItemSize: itemSize,
  });
  return {
    Key: arr(anim.keyOffset),
    Time: { ...arr(anim.timeOffset), ItemSize: 1 },
  };
}

function convertScene({ children, clip, files }) {
  const osgjs = {
    Generator: "test",
    Version: 9,
    "osg.Node": {
      Name: "scene",
      Children: children,
      ...(clip
        ? {
            UpdateCallbacks: [
              {
                "osgAnimation.BasicAnimationManager": {
                  Animations: [
                    {
                      "osgAnimation.Animation": {
                        Name: clip.name,
                        Channels: clip.channels,
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {}),
    },
  };
  return convertOsgjsToGlbFromFiles({
    "file.osgjs": JSON.stringify(osgjs),
    ...files,
  });
}

test("animation bins resolve next to /files/, not the file.binz sibling", needsSamples, async () => {
  const osgjsUrl =
    "https://media.sketchfab.com/models/uid/ver/files/filehash/file.binz?token=abc";
  const snakes = await readFile(
    join(samples, "Animated_snakes_pack-88d57c4b/file.osgjs"),
    "utf8"
  );
  const names = collectAnimationBinGzNames(snakes);
  assert.ok(names.includes("8634bc4dc73c463e82e8397a4a7aa8a7.bin.gz"));
  assert.equal(new Set(names).size, names.length);

  const urls = extraAnimationUrls(osgjsUrl, snakes);
  assert.ok(urls.every((u) => u.startsWith("https://media.sketchfab.com/models/uid/ver/animations/")));
  assert.ok(urls.every((u) => u.endsWith("?token=abc") && !u.includes("/files/")));
  assert.ok(urls.some((u) => u.includes("8634bc4dc73c463e82e8397a4a7aa8a7.bin.gz")));

  const door = await readFile(join(samples, "BulkHead_Door-95ba8c1b/file.osgjs"), "utf8");
  assert.deepEqual(collectAnimationBinGzNames(door), []);
  assert.deepEqual(extraAnimationUrls(osgjsUrl, door), []);
  assert.deepEqual(extraAnimationUrls(osgjsUrl, '{"osg.Node":{}}'), []);
});

test("gunzip + Float32 Key/Time decode", async () => {
  const keys = new Float32Array([1, 2, 3, 4, 5, 6]);
  const times = new Float32Array([0, 1]);
  const raw = new Uint8Array(keys.byteLength + times.byteLength);
  raw.set(new Uint8Array(keys.buffer), 0);
  raw.set(new Uint8Array(times.buffer), keys.byteLength);
  const unzipped = await gunzipBytes(gzipSync(raw));
  const keyOut = readBufferArray(unzipped, { Offset: 0, Size: 2, ItemSize: 3 }, "Float32Array");
  const timeOut = readBufferArray(
    unzipped,
    { Offset: keys.byteLength, Size: 2, ItemSize: 1 },
    "Float32Array"
  );
  assert.deepEqual([...keyOut], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...timeOut], [0, 1]);
});

test("packed vec3 dequant is origin + bbox + q*step; ORIGIN_KEY prepends rest", () => {
  const encoded = new Uint16Array([0, 10, 100]);
  const out = dequantizePackedVec3(encoded, {
    ox: 1, oy: 2, oz: 3,
    bx: 0.5, by: -0.25, bz: 0,
    hx: 0.1, hy: 0.01, hz: 0.001,
  });
  assert.ok(near(out[0], 1 + 0.5) && near(out[1], 2 - 0.25 + 0.1) && near(out[2], 3 + 0.1));

  const keyed = decodePackedVec3(new Uint16Array([0, 0, 0]), {
    channel_mode: ANIM_CHANNEL_MODE.BBOX | ANIM_CHANNEL_MODE.ORIGIN_KEY,
    ox: 1, oy: 2, oz: 74,
    bx: 0.5, by: 0, bz: -0.1,
    hx: 0.1, hy: 0.01, hz: 0.001,
  });
  assert.equal(keyed.length, 6);
  assert.ok(near(keyed[0], 1) && near(keyed[1], 2) && near(keyed[2], 74));
  assert.ok(near(keyed[3], 1.5) && near(keyed[4], 2) && near(keyed[5], 73.9));
});

test("collapseNonIncreasing keeps the last value on a tie", () => {
  const collapsed = collapseNonIncreasing(
    new Float32Array([0, 0.1, 0.1, 0.2]),
    new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    3
  );
  assert.equal(collapsed.times.length, 3);
  assert.ok(near(collapsed.times[0], 0) && near(collapsed.times[1], 0.1) && near(collapsed.times[2], 0.2));
  assert.ok(near(collapsed.values[3], 7));
});

test("packed identity quat is [0,0,0,1]; ORIGIN_KEY prepends rest", () => {
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
    channel_mode: ANIM_CHANNEL_MODE.ORIGIN_KEY,
  });
  assert.equal(composed.length, 8);
  assert.ok(near(Math.hypot(composed[0], composed[1], composed[2], composed[3]), 1));
  assert.ok(near(composed[0], origin.ox, 1e-4) && near(composed[3], origin.ow, 1e-4));
  assert.ok(near(composed[4], origin.ox, 1e-4) && near(composed[7], origin.ow, 1e-4));
});

test("TIME_DELTA prefix-sum and planar deinterleave", () => {
  const times = new Float32Array([0, 0.033, 0.00033, 0.03333]);
  prefixSum(times, 1);
  assert.ok(near(times[0], 0) && near(times[1], 0.033) && near(times[3], 0.06666, 1e-4));
  assert.deepEqual([...deinterleavePlanar([1, 2, 10, 20, 100, 200], 3)], [1, 10, 100, 2, 20, 200]);
});

test("Y-up remaps translation and rotation like conjugateZupToYup", () => {
  const t = remapTranslationYup(0, 5, 0);
  assert.ok(near(t[0], 0) && near(t[1], 0) && near(t[2], -5));
  const identity = remapRotationYup([0, 0, 0, 1]);
  assert.ok(near(identity[0], 0) && near(identity[1], 0) && near(identity[2], 0) && near(identity[3], 1));
  const qy = remapRotationYup([0, 0, Math.SQRT1_2, Math.SQRT1_2]);
  assert.ok(near(qy[0], 0) && near(qy[1], Math.SQRT1_2) && near(qy[2], 0) && near(qy[3], Math.SQRT1_2));
});

test("synthetic Vec3 translate clip targets the named node", async () => {
  const anim = floatBin([0, 5, 0, 0, 5, 0], [0, 1]);
  const { json } = await convertScene({
    children: [
      {
        "osg.MatrixTransform": {
          Name: "BoneA",
          Matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          Children: [{ "osg.Geometry": triangleGeom(16) }],
        },
      },
    ],
    clip: {
      name: "Take 001",
      channels: [
        {
          "osgAnimation.Vec3LerpChannel": {
            Name: "translate",
            TargetName: "BoneA",
            KeyFrames: keyframes("clip.bin.gz", anim, 3),
          },
        },
      ],
    },
    files: { "model_file.bin": packMeshBin(), "clip.bin.gz": anim.bytes },
  });
  assert.equal(json.animations.length, 1);
  assert.equal(json.animations[0].name, "Take 001");
  const ch = json.animations[0].channels[0];
  assert.equal(ch.target.path, "translation");
  assert.equal(json.nodes[ch.target.node].name, "BoneA");
});

test("animation TargetName matches UpdateBone alias, not only Bone.Name", async () => {
  const anim = floatBin([0, 0, 0, 1, 2, 3], [0, 1]);
  const { json } = await convertScene({
    children: [
      {
        "osgAnimation.Bone": {
          Name: "Bip01 L Toe0Nub_09",
          Matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          UpdateCallbacks: [{ "osgAnimation.UpdateBone": { Name: "Bip01 L Toe0Nub_0" } }],
          Children: [{ "osg.Geometry": triangleGeom(16) }],
        },
      },
    ],
    clip: {
      name: "motion4",
      channels: [
        {
          "osgAnimation.Vec3LerpChannel": {
            Name: "translate",
            TargetName: "Bip01 L Toe0Nub_0",
            KeyFrames: keyframes("clip.bin.gz", anim, 3),
          },
        },
      ],
    },
    files: { "model_file.bin": packMeshBin(), "clip.bin.gz": anim.bytes },
  });
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
  const { json } = await convertScene({
    children: [
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
    clip: {
      name: "Key.001Action",
      channels: [
        {
          "osgAnimation.FloatLerpChannel": {
            Name: "0",
            TargetName: "open_jaw",
            KeyFrames: keyframes("morph.bin.gz", anim, 1),
          },
        },
      ],
    },
    files: { "model_file.bin": extra, "morph.bin.gz": anim.bytes },
  });
  const ch = json.animations[0].channels[0];
  assert.equal(json.animations[0].name, "Key.001Action");
  assert.equal(ch.target.path, "weights");
  const mesh = json.meshes[json.nodes[ch.target.node].mesh];
  assert.equal(mesh.weights.length, 1);
  assert.equal(mesh.extras.targetNames[0], "open_jaw");
});
