import { test } from "node:test";
import assert from "node:assert/strict";
import { packDebugFiles } from "../src/lib/pipeline.js";
import { summarizeOsgAnimations } from "../src/lib/osgjs2gltf.js";

test("packDebugFiles writes log, info, gltf, and README without stuffing gltf into info.json", () => {
  const files = packDebugFiles({
    name: "eagle",
    uid8: "8fb15027",
    glb: new Uint8Array([1, 2, 3]),
    decrypted: {
      "file.osgjs": new TextEncoder().encode("{}"),
      "model_file.bin": new Uint8Array([0]),
      "textures/skip.png": new Uint8Array([9]),
    },
    logLines: ["UID: 8fb15027", "GLB ready"],
    info: {
      uid: "8fb15027",
      animFetch: [{ fname: "aa.bin.gz", ok: false, error: "HTTP 403" }],
      gltf: { asset: { version: "2.0" }, nodes: [{ name: "Root" }] },
    },
  });
  const byName = Object.fromEntries(files.map((f) => [f.name, f.data]));
  assert.ok(byName["eagle-8fb15027.glb"]);
  assert.ok(byName["file.osgjs"]);
  assert.ok(byName["model_file.bin"]);
  assert.equal(byName["textures/skip.png"], undefined);
  assert.ok(byName["debug/README.txt"]);
  assert.match(new TextDecoder().decode(byName["debug/log.txt"]), /UID: 8fb15027/);
  const info = JSON.parse(new TextDecoder().decode(byName["debug/info.json"]));
  assert.equal(info.uid, "8fb15027");
  assert.equal(info.gltf, undefined);
  assert.equal(info.animFetch[0].error, "HTTP 403");
  const gltf = JSON.parse(new TextDecoder().decode(byName["debug/gltf.json"]));
  assert.equal(gltf.nodes[0].name, "Root");
});

test("summarizeOsgAnimations lists clip TargetName and bin files", () => {
  const osgjs = {
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
                    Time: { Array: { Float32Array: { File: "aa.bin.gz" } } },
                    Key: { Array: { Float32Array: { File: "aa.bin.gz" } } },
                  },
                },
              },
            ],
          },
        },
      ],
    },
  };
  const clips = summarizeOsgAnimations(osgjs);
  assert.equal(clips.length, 1);
  assert.equal(clips[0].name, "motion4");
  assert.equal(clips[0].channels[0].target, "Bip01 L Toe0Nub_0");
  assert.equal(clips[0].channels[0].timeFile, "aa.bin.gz");
});
