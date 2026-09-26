import { test } from "node:test";
import assert from "node:assert/strict";
import { packGltfFiles } from "../src/lib/pipeline.js";

test("packGltfFiles writes model.gltf, model.bin, and unique textures/", () => {
  const jsonText = new TextEncoder().encode('{"asset":{"version":"2.0"}}');
  const bin = new Uint8Array([1, 2, 3, 4]);
  const tex = new Uint8Array([9, 9]);
  const files = packGltfFiles({
    jsonText,
    bin,
    textureAliases: [
      { from: "textures/Albedo.jpg", to: "textures/Albedo.jpg", data: tex },
      { from: "dup", to: "textures/Albedo.jpg", data: tex },
      { from: "skip", to: "", data: tex },
    ],
  });
  const byName = Object.fromEntries(files.map((f) => [f.name, f.data]));
  assert.equal(files.length, 3);
  assert.equal(byName["model.gltf"], jsonText);
  assert.equal(byName["model.bin"], bin);
  assert.equal(byName["textures/Albedo.jpg"], tex);
});
