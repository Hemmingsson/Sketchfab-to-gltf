import { test } from "node:test";
import assert from "node:assert/strict";
import { parseViewerMaterials, normalizeUvTransform } from "../lib/sf-api.js";
import {
  classifyTextureName,
  convertOsgjsToGlbFromFiles,
  findViewerSpec,
  chooseAlbedoName,
  shouldSkipUntexturedShell,
} from "../lib/osgjs2gltf.js";

function tex(uid, enable = true) {
  return { enable, texture: { uid } };
}

test("parseViewerMaterials uses DiffusePBR and BumpMap, not specular as albedo", () => {
  const info = {
    options: {
      materials: {
        m1: {
          name: "lambert2SG",
          channels: {
            AlbedoPBR: { enable: false, texture: { uid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } },
            DiffusePBR: tex("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", true),
            SpecularPBR: tex("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", true),
            BumpMap: tex("cccccccccccccccccccccccccccccccc", true),
            NormalMap: { enable: false, texture: { uid: "cccccccccccccccccccccccccccccccc" } },
          },
        },
      },
    },
  };
  const map = parseViewerMaterials(info);
  const spec = map.get("lambert2SG");
  assert.ok(spec);
  assert.equal(spec.albedoUid, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(spec.normalUid, "cccccccccccccccccccccccccccccccc");
  assert.equal(spec.specularUid, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.notEqual(spec.albedoUid, spec.specularUid);
});

test("classifyTextureName matches NormalMap / SpecularMap substrings", () => {
  assert.equal(classifyTextureName("Archer_NormalMap.png"), "normal");
  assert.equal(classifyTextureName("Archer_SpecularMap.png"), "specular");
  assert.equal(classifyTextureName("Body_D.png"), "albedo");
});

test("findViewerSpec matches StateSet-style names", () => {
  const vm = new Map();
  vm.set("lambert2SG", { name: "lambert2SG" });
  const hit = findViewerSpec(vm, null, "lambert2SG");
  assert.ok(hit);
  assert.equal(hit.spec.name, "lambert2SG");
});

test("chooseAlbedoName promotes a large unknown specular atlas over a tiny diffuse", () => {
  const list = [
    { name: "textures/Image2.png", width: 400, height: 401, fromDescramble: false },
    { name: "textures/pant_final.png", width: 4096, height: 4096, fromDescramble: true },
  ];
  assert.equal(
    chooseAlbedoName("Image2.png", "pant_final.png", list),
    "pant_final.png"
  );
});

test("chooseAlbedoName does not steal a named SpecularMap", () => {
  const list = [
    { name: "textures/Body_D.png", width: 2048, height: 2048, fromDescramble: true },
    { name: "textures/Archer_SpecularMap.png", width: 4096, height: 4096 },
  ];
  assert.equal(
    chooseAlbedoName("Body_D.png", "Archer_SpecularMap.png", list),
    "Body_D.png"
  );
});

test("shouldSkipUntexturedShell keeps hair that has an opacity atlas", () => {
  assert.equal(
    shouldSkipUntexturedShell(
      { albedoUid: null, opacityUid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      "hair:Group49590SG",
      null
    ),
    false
  );
  assert.equal(
    shouldSkipUntexturedShell(
      { albedoUid: null, opacityUid: null },
      "hair:Group49590SG",
      null
    ),
    true
  );
});

test("a visible refractive glass cover is exported, not skipped", () => {
  // vpcm2_glass_cover: opacity factor 1, type 'refraction'. The old name-based
  // /glass/i rule dropped the mesh, so the model lost its glossy screen.
  const info = {
    options: {
      materials: {
        g1: {
          name: "vpcm2_glass_cover",
          channels: {
            AlbedoPBR: tex("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", true),
            Opacity: { enable: true, factor: 1, type: "refraction" },
          },
        },
      },
    },
  };
  const spec = parseViewerMaterials(info).get("vpcm2_glass_cover");
  assert.equal(spec.skipMesh, false, "visible glass must survive export");
  assert.equal(spec.transmission, true, "and be marked for KHR_materials_transmission");
});

test("an invisible glass shell is still skipped", () => {
  const info = {
    options: {
      materials: {
        g1: {
          name: "window_glass",
          channels: {
            AlbedoPBR: tex("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", true),
            Opacity: { enable: true, factor: 0, type: "alphaBlend" },
          },
        },
      },
    },
  };
  const spec = parseViewerMaterials(info).get("window_glass");
  assert.equal(spec.skipMesh, true, "a fully transparent veil must still be dropped");
});

test("a non-refractive named glass shell is still skipped", () => {
  const info = {
    options: {
      materials: {
        g1: {
          name: "glass_rim",
          channels: {
            AlbedoPBR: tex("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", true),
            Opacity: { enable: true, factor: 1, type: "alphaBlend" },
          },
        },
      },
    },
  };
  const spec = parseViewerMaterials(info).get("glass_rim");
  assert.equal(spec.skipMesh, true);
});

function uvTex(uid, unit, xf) {
  return {
    enable: true,
    texture: { uid, texCoordUnit: unit },
    UVTransforms: xf,
  };
}

test("normalizeUvTransform drops identity and keeps dyson-scale values", () => {
  assert.equal(normalizeUvTransform({ offset: [0, 0], scale: [1, 1], rotation: 0 }), null);
  assert.equal(normalizeUvTransform(undefined), null);
  const metal = normalizeUvTransform({ offset: [0, -14], scale: [10, 15], rotation: 0 });
  assert.deepEqual(metal.offset, [0, -14]);
  assert.deepEqual(metal.scale, [10, 15]);
  assert.equal(metal.rotation, 0);
  const light = normalizeUvTransform({
    offset: [-1, 0],
    scale: [3, 3],
    rotation: 2.778279217460362,
  });
  assert.ok(Math.abs(light.rotation - 2.778279217460362) < 1e-8);
});

test("parseViewerMaterials reads UVTransforms and texCoordUnit per channel", () => {
  const map = parseViewerMaterials({
    options: {
      materials: {
        metal: {
          name: "MAT_METAL_1",
          channels: {
            AlbedoPBR: uvTex("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 1, {
              offset: [0, -14],
              scale: [10, 15],
              rotation: 0,
            }),
            NormalMap: uvTex("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", 1, {
              offset: [0, -14],
              scale: [10, 15],
              rotation: 0,
            }),
            MetalnessPBR: uvTex("cccccccccccccccccccccccccccccccc", 1, {
              offset: [0, -14],
              scale: [10, 15],
              rotation: 0,
            }),
            RoughnessPBR: uvTex("dddddddddddddddddddddddddddddddd", 1, {
              offset: [0, -14],
              scale: [10, 15],
              rotation: 0,
            }),
          },
        },
        light: {
          name: "MAT_LIGHT_1",
          channels: {
            AlbedoPBR: uvTex("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", 3, {
              offset: [-1, 0],
              scale: [3, 3],
              rotation: 2.778279217460362,
            }),
            EmitColor: uvTex("ffffffffffffffffffffffffffffffff", 3, {
              offset: [0, 0],
              scale: [4, 4],
              rotation: 0,
            }),
            Matcap: uvTex("11111111111111111111111111111111", 3, {
              offset: [0, 0],
              scale: [1, 1],
              rotation: 0,
            }),
          },
        },
        plain: {
          name: "queen_sword",
          channels: {
            AlbedoPBR: tex("22222222222222222222222222222222", true),
          },
        },
      },
    },
  });
  const metal = map.get("MAT_METAL_1");
  assert.deepEqual(metal.uv.albedo.transform.offset, [0, -14]);
  assert.deepEqual(metal.uv.albedo.transform.scale, [10, 15]);
  assert.equal(metal.uv.albedo.texCoordUnit, 1);
  assert.deepEqual(metal.uv.normal.transform.scale, [10, 15]);
  const light = map.get("MAT_LIGHT_1");
  assert.deepEqual(light.uv.albedo.transform.offset, [-1, 0]);
  assert.ok(Math.abs(light.uv.albedo.transform.rotation - 2.778279217460362) < 1e-8);
  assert.equal(light.uv.albedo.texCoordUnit, 3);
  assert.deepEqual(light.uv.emit.transform.scale, [4, 4]);
  assert.deepEqual(light.uv.emit.transform.offset, [0, 0]);
  assert.equal(map.get("queen_sword").uv.albedo.transform, null);
});

const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  ),
  (c) => c.charCodeAt(0)
);

function packMeshBin() {
  const idx = new Uint16Array([0, 1, 2]);
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const bin = new Uint8Array(16 + pos.byteLength);
  bin.set(new Uint8Array(idx.buffer), 0);
  bin.set(new Uint8Array(pos.buffer), 16);
  return bin;
}

function namedTri(name) {
  return {
    "osg.Geometry": {
      Name: name,
      StateSet: { "osg.StateSet": { Name: name } },
      PrimitiveSetList: [
        {
          DrawElementsUShort: {
            Mode: "TRIANGLES",
            Indices: { Array: { Uint16Array: { Size: 3, Offset: 0 } } },
          },
        },
      ],
      VertexAttributeList: {
        Vertex: { ItemSize: 3, Array: { Float32Array: { Size: 3, Offset: 16 } } },
      },
    },
  };
}

test("convert emits KHR_texture_transform and does not merge distinct tilings", async () => {
  const uidA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const uidB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const viewer = parseViewerMaterials({
    options: {
      materials: {
        metal: {
          name: "MAT_METAL_1",
          channels: {
            AlbedoPBR: uvTex(uidA, 1, { offset: [0, -14], scale: [10, 15], rotation: 0 }),
            NormalMap: uvTex(uidB, 1, { offset: [0, -14], scale: [10, 15], rotation: 0 }),
          },
        },
        light: {
          name: "MAT_LIGHT_1",
          channels: {
            AlbedoPBR: uvTex(uidA, 3, { offset: [-1, 0], scale: [3, 3], rotation: 2.778279217460362 }),
            EmitColor: {
              enable: true,
              factor: 1.3,
              color: [1, 1, 1],
              texture: { uid: uidB, texCoordUnit: 3 },
              UVTransforms: { offset: [0, 0], scale: [4, 4], rotation: 0 },
            },
          },
        },
        plain: {
          name: "queen_sword",
          channels: { AlbedoPBR: tex(uidA, true) },
        },
      },
    },
  });
  const osgjs = {
    Generator: "test",
    Version: 9,
    "osg.Node": {
      Name: "scene",
      Children: ["MAT_METAL_1", "MAT_LIGHT_1", "queen_sword"].map((name) => ({
        "osg.MatrixTransform": {
          Name: name,
          Matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          Children: [namedTri(name)],
        },
      })),
    },
  };
  const { json } = await convertOsgjsToGlbFromFiles(
    { "file.osgjs": JSON.stringify(osgjs), "model_file.bin": packMeshBin() },
    viewer,
    [
      { name: "textures/albedo.png", uid: uidA, data: TINY_PNG },
      { name: "textures/aux.png", uid: uidB, data: TINY_PNG },
    ],
    "uv-xform"
  );
  assert.ok((json.extensionsUsed || []).includes("KHR_texture_transform"));
  const byName = Object.fromEntries((json.materials || []).map((m) => [m.name, m]));
  const metalXf =
    byName.MAT_METAL_1.pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform;
  assert.equal(byName.MAT_METAL_1.pbrMetallicRoughness.baseColorTexture.texCoord, 0);
  assert.deepEqual(metalXf.offset, [0, -14]);
  assert.deepEqual(metalXf.scale, [10, 15]);
  assert.equal(metalXf.texCoord, 0);
  const lightXf =
    byName.MAT_LIGHT_1.pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform;
  assert.ok(Math.abs(lightXf.offset[0] + 1) < 1e-4);
  assert.ok(Math.abs(lightXf.scale[0] - 3) < 1e-4);
  assert.ok(Math.abs(lightXf.rotation - 2.778279217460362) < 1e-4);
  const emitXf = byName.MAT_LIGHT_1.emissiveTexture.extensions.KHR_texture_transform;
  assert.deepEqual(emitXf.scale, [4, 4]);
  assert.equal(emitXf.offset, undefined);
  assert.equal(
    byName.queen_sword.pbrMetallicRoughness.baseColorTexture.extensions,
    undefined
  );
  assert.equal((json.materials || []).length, 3);
});

test("getColor honors factor: 0 is off, 0..1 lerps toward default", () => {
  const map = parseViewerMaterials({
    options: {
      materials: {
        swat: {
          name: "uniform",
          channels: {
            SpecularF0: { enable: true, factor: 0.5 },
            SpecularColor: { enable: true, factor: 0, color: [0.5, 0.5, 0.5] },
            Sheen: { enable: true, factor: 0, color: [1, 0, 0] },
          },
        },
        queen: {
          name: "human.body",
          channels: {
            SpecularF0: { enable: true, factor: 0.716 },
            SpecularColor: { enable: true, factor: 0.25, color: [0.8, 0.8, 0.8] },
            Sheen: { enable: true, factor: 0.5, color: [1, 0, 0] },
          },
        },
      },
    },
  });
  const swat = map.get("uniform");
  assert.equal(swat.specularFactor, 0.5);
  assert.deepEqual(swat.specularColorFactor, [1, 1, 1]);
  assert.deepEqual(swat.sheenColorFactor, [0, 0, 0]);
  const queen = map.get("human.body");
  assert.equal(queen.specularFactor, 0.716);
  assert.deepEqual(
    queen.specularColorFactor.map((c) => Math.round(c * 1e6) / 1e6),
    [0.95, 0.95, 0.95]
  );
  assert.deepEqual(queen.sheenColorFactor, [0.5, 0, 0]);
});

test("convert drops SSS volume, keeps refraction, and gates specular to real F0", async () => {
  const uidA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const viewer = parseViewerMaterials({
    options: {
      materials: {
        skin: {
          name: "face",
          channels: {
            AlbedoPBR: tex(uidA, true),
            SpecularF0: { enable: true, factor: 0.5 },
            SpecularColor: { enable: true, factor: 0, color: [0.5, 0.5, 0.5] },
            SubsurfaceScattering: { enable: true, factor: 2.376 },
          },
        },
        cloth: {
          name: "uniform",
          channels: {
            AlbedoPBR: tex(uidA, true),
            SpecularF0: { enable: true, factor: 0.158 },
            SpecularColor: { enable: true, factor: 0, color: [0.5, 0.5, 0.5] },
          },
        },
        eyes: {
          name: "eyes",
          channels: {
            AlbedoPBR: tex(uidA, true),
            SpecularF0: { enable: true, factor: 0.423 },
            Opacity: { enable: true, type: "refraction", factor: 1 },
          },
        },
      },
    },
  });
  const osgjs = {
    Generator: "test",
    Version: 9,
    "osg.Node": {
      Name: "scene",
      Children: ["face", "uniform", "eyes"].map((name) => ({
        "osg.MatrixTransform": {
          Name: name,
          Matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          Children: [namedTri(name)],
        },
      })),
    },
  };
  const { json } = await convertOsgjsToGlbFromFiles(
    { "file.osgjs": JSON.stringify(osgjs), "model_file.bin": packMeshBin() },
    viewer,
    [{ name: "textures/albedo.png", uid: uidA, data: TINY_PNG }],
    "f4-materials"
  );
  const byName = Object.fromEntries((json.materials || []).map((m) => [m.name, m]));
  assert.equal(byName.face.extensions?.KHR_materials_volume, undefined);
  assert.equal(byName.face.extensions?.KHR_materials_transmission, undefined);
  assert.equal(byName.face.extensions?.KHR_materials_specular, undefined);
  assert.ok(!(json.extensionsUsed || []).includes("KHR_materials_volume"));
  const spec = byName.uniform.extensions.KHR_materials_specular;
  assert.ok(Math.abs(spec.specularFactor - 0.316) < 1e-3);
  assert.deepEqual(spec.specularColorFactor, [1, 1, 1]);
  assert.equal(byName.eyes.extensions.KHR_materials_transmission.transmissionFactor, 1);
  assert.equal(byName.eyes.alphaMode, "OPAQUE");
  assert.ok(Math.abs(byName.eyes.extensions.KHR_materials_specular.specularFactor - 0.846) < 1e-3);
});
