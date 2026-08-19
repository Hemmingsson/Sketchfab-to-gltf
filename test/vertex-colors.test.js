import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  shouldKeepVertexColors,
  processGeometry,
  convertOsgjsToGlbFromFiles,
} from "../lib/osgjs2gltf.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const samples = join(root, ".context/samples");

function repeatRgba(rgba, verts) {
  const out = new Float32Array(verts * rgba.length);
  for (let i = 0; i < verts; i++) out.set(rgba, i * rgba.length);
  return out;
}

function packTriangleGeom({ colors, itemSize, colorType = "Float32Array" }) {
  const idx = new Uint16Array([0, 1, 2]);
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const colorBytes =
    colors instanceof Uint8Array ? colors : new Uint8Array(colors.buffer, colors.byteOffset, colors.byteLength);
  const bin = new Uint8Array(16 + pos.byteLength + colorBytes.byteLength);
  bin.set(new Uint8Array(idx.buffer), 0);
  bin.set(new Uint8Array(pos.buffer), 16);
  bin.set(colorBytes, 16 + pos.byteLength);
  const geom = {
    Name: "vc_tri",
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
      Color: {
        ItemSize: itemSize,
        Array: { [colorType]: { Size: 3, Offset: 16 + pos.byteLength } },
      },
    },
  };
  return { geom, bin: bin.buffer };
}

function collectColorAttrs(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectColorAttrs(child, out);
    return out;
  }
  if (node.Color && node.Color.ItemSize) out.push(node.Color);
  for (const v of Object.values(node)) collectColorAttrs(v, out);
  return out;
}

function gltfHasColor0(json) {
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      if (prim.attributes && prim.attributes.COLOR_0 !== undefined) return true;
    }
  }
  return false;
}

test("shouldKeepVertexColors skips constant pink+0.5 engine tint", () => {
  const tint = repeatRgba([1, 0.4, 0.7, 0.5], 32);
  assert.equal(shouldKeepVertexColors(tint, 4), false);
});

test("shouldKeepVertexColors skips near-constant Uint8 tint", () => {
  const tint = new Uint8Array(16);
  for (let i = 0; i < 4; i++) tint.set([255, 102, 178, 128], i * 4);
  tint[5] = 103; // 1/255 noise on G
  assert.equal(shouldKeepVertexColors(tint, 4), false);
});

test("shouldKeepVertexColors keeps per-vertex RGB variation", () => {
  const rgb = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.equal(shouldKeepVertexColors(rgb, 3), true);
});

test("shouldKeepVertexColors keeps per-vertex RGBA variation", () => {
  const rgba = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0.2]);
  assert.equal(shouldKeepVertexColors(rgba, 4), true);
});

test("processGeometry emits COLOR_0 for varied colors and skips a tint", () => {
  const varied = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1]);
  const { geom, bin } = packTriangleGeom({ colors: varied, itemSize: 4 });
  const kept = processGeometry(geom, bin, null);
  assert.ok(kept.attributes.COLOR_0);
  assert.equal(kept.attributes.COLOR_0.itemSize, 4);
  assert.equal(kept.attributes.COLOR_0.data.length, 12);

  const tint = repeatRgba([1, 0.4, 0.7, 0.5], 3);
  const skipped = processGeometry(
    packTriangleGeom({ colors: tint, itemSize: 4 }).geom,
    packTriangleGeom({ colors: tint, itemSize: 4 }).bin,
    null
  );
  assert.equal(skipped.attributes.COLOR_0, undefined);
});

test("processGeometry keeps itemSize 3 as COLOR_0 VEC3", () => {
  const rgb = new Float32Array([0.1, 0.2, 0.3, 0.9, 0.8, 0.1, 0.2, 0.7, 0.4]);
  const { geom, bin } = packTriangleGeom({ colors: rgb, itemSize: 3 });
  const result = processGeometry(geom, bin, null);
  assert.equal(result.attributes.COLOR_0.itemSize, 3);
  assert.deepEqual([...result.attributes.COLOR_0.data], [...rgb]);
});

test("Fall_and_Rise sample declares a Color attr; helper would keep varied data", async () => {
  const osgjs = JSON.parse(
    await readFile(join(samples, "Fall_and_Rise_animated-eea2c665/file.osgjs"), "utf8")
  );
  const colors = collectColorAttrs(osgjs);
  assert.ok(colors.length >= 1);
  assert.ok(colors.some((c) => c.ItemSize === 3 || c.ItemSize === 4));
  // No model_file.bin in this sample dir — prove keep path with decoded-shaped data.
  const varied = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 128]);
  assert.equal(shouldKeepVertexColors(varied, 4), true);
});

test("Battle-Scarred soldier (bin, no Color) stays tint-free", async () => {
  const dir = join(samples, "Battle-Scarred_Armored_Soldier-f5937af9");
  const fileMap = {
    "file.osgjs": await readFile(join(dir, "file.osgjs"), "utf8"),
    "model_file.bin": new Uint8Array(await readFile(join(dir, "model_file.bin"))),
  };
  const { json } = await convertOsgjsToGlbFromFiles(fileMap);
  assert.equal(gltfHasColor0(json), false);
});
