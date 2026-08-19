import { test } from "node:test";
import assert from "node:assert/strict";
import { parseViewerMaterials, parseViewerScene, officialAnimationUrls } from "../lib/sf-api.js";
import {
  convertOsgjsToGlbFromFiles,
  lookAtRotation,
  mat4TranslationRotation,
} from "../lib/osgjs2gltf.js";
import { extraAnimationUrls } from "../lib/pipeline.js";

function tex(uid, enable = true) {
  return { enable, texture: { uid } };
}

function triangleOsgjs() {
  return {
    Generator: "test",
    Version: 9,
    "osg.Node": {
      Name: "scene",
      Children: [
        {
          "osg.MatrixTransform": {
            Name: "Mesh",
            Matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            Children: [
              {
                "osg.Geometry": {
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
                },
              },
            ],
          },
        },
      ],
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

test("parseViewerScene reads camera and enabled punctual lights", () => {
  const scene = parseViewerScene({
    options: {
      scene: { fov: 45, nearFarRatio: 0.01 },
      camera: { position: [0, 2, 5], target: [0, 0, 0] },
      lighting: {
        enable: true,
        lights: [
          {
            type: "DIRECTION",
            enable: true,
            color: [1, 0.9, 0.8],
            intensity: 0.7,
            matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1],
          },
          { type: "SPOT", enable: false, color: [1, 1, 1], intensity: 1 },
        ],
      },
      shading: { type: "lit" },
    },
  });
  assert.ok(scene.camera);
  assert.equal(scene.camera.position[2], 5);
  assert.ok(Math.abs(scene.camera.yfov - Math.PI / 4) < 1e-6);
  assert.equal(scene.lights.length, 1);
  assert.equal(scene.lights[0].type, "directional");
  assert.equal(scene.unlit, false);
});

test("parseViewerScene skips lights when the studio switch is off", () => {
  const scene = parseViewerScene({
    options: {
      lighting: {
        enable: false,
        lights: [{ type: "DIRECTION", enable: true, color: [1, 1, 1], intensity: 1 }],
      },
    },
  });
  assert.deepEqual(scene.lights, []);
});

test("officialAnimationUrls prefers the prefetch /animations list", () => {
  const urls = officialAnimationUrls(
    {
      "/i/models/abc/animations?optimized=1": {
        results: [{ url: "https://media.sketchfab.com/x/animations/aa.bin.gz" }],
      },
    },
    "abc"
  );
  assert.deepEqual(urls, ["https://media.sketchfab.com/x/animations/aa.bin.gz"]);
  assert.deepEqual(
    extraAnimationUrls("https://media.sketchfab.com/files/h/file.binz", "{}", urls),
    urls
  );
});

test("lookAtRotation points the −Z axis at the target", () => {
  const q = lookAtRotation([0, 0, 5], [0, 0, 0]);
  assert.ok(Math.abs(q[0]) < 1e-6 && Math.abs(q[1]) < 1e-6);
  assert.ok(Math.abs(q[3]) > 0.9);
  const tr = mat4TranslationRotation([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 9, 8, 7, 1]);
  assert.deepEqual(tr.translation, [9, 8, 7]);
});

test("convert emits a glTF camera and KHR_lights_punctual", async () => {
  const { json } = await convertOsgjsToGlbFromFiles(
    {
      "file.osgjs": JSON.stringify(triangleOsgjs()),
      "model_file.bin": packMeshBin(),
    },
    null,
    [],
    "cam-test",
    {
      camera: { position: [0, 1, 4], target: [0, 0, 0], yfov: 0.8 },
      lights: [
        {
          type: "directional",
          color: [1, 1, 1],
          intensity: 0.5,
          matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1],
        },
      ],
      unlit: false,
      nearFarRatio: 0.005,
    }
  );
  assert.equal((json.cameras || []).length, 1);
  assert.ok(json.nodes.some((n) => n.camera === 0));
  assert.ok((json.extensionsUsed || []).includes("KHR_lights_punctual"));
  assert.equal(json.extensions.KHR_lights_punctual.lights[0].type, "directional");
});

test("parseViewerMaterials keeps clearcoat / sheen / displacement channels", () => {
  const map = parseViewerMaterials({
    options: {
      materials: {
        m: {
          name: "coat",
          channels: {
            AlbedoPBR: tex("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            ClearCoat: { enable: true, factor: 0.8, texture: { uid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } },
            Sheen: { enable: true, color: [1, 0, 0], factor: 1 },
            Displacement: { enable: true, factor: 0.05, texture: { uid: "cccccccccccccccccccccccccccccccc" } },
            IOR: { enable: true, factor: 1.4 },
          },
        },
      },
    },
  });
  const spec = map.get("coat");
  assert.equal(spec.clearcoatFactor, 0.8);
  assert.equal(spec.clearcoatUid, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.deepEqual(spec.sheenColorFactor, [1, 0, 0]);
  assert.equal(spec.displacementFactor, 0.05);
  assert.equal(spec.ior, 1.4);
});
