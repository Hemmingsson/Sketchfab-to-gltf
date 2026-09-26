import { test } from "node:test";
import assert from "node:assert/strict";
import { parseViewerMaterials } from "../src/lib/sf-api.js";
import {
  classifyTextureName,
  findViewerSpec,
  chooseAlbedoName,
  shouldSkipUntexturedShell,
} from "../src/lib/osgjs2gltf.js";

function tex(uid, enable = true) {
  return { enable, texture: { uid } };
}

function glassSpec(name, opacity) {
  return parseViewerMaterials({
    options: {
      materials: {
        m: {
          name,
          channels: {
            AlbedoPBR: tex("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", true),
            Opacity: { enable: true, ...opacity },
          },
        },
      },
    },
  }).get(name);
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

test("glass skip is refraction/opacity, not a /glass/ name match", () => {
  // vpcm2_glass_cover: opacity 1 + refraction. The old /glass/i rule dropped the screen.
  const cover = glassSpec("vpcm2_glass_cover", { factor: 1, type: "refraction" });
  assert.equal(cover.skipMesh, false, "visible glass must survive export");
  assert.equal(cover.transmission, true, "and be marked for KHR_materials_transmission");
  assert.equal(glassSpec("window_glass", { factor: 0, type: "alphaBlend" }).skipMesh, true);
  assert.equal(glassSpec("glass_rim", { factor: 1, type: "alphaBlend" }).skipMesh, true);
});

test("'rim' only counts as a whole token, so Trim / Brim / Rimini survive", () => {
  const blend = { factor: 1, type: "alphaBlend" };
  for (const name of ["Trim", "Brim", "Rimini", "trim_metal"]) {
    assert.equal(glassSpec(name, blend).skipMesh, false, `${name} must not be treated as a glass shell`);
  }
  for (const name of ["Rim", "rim_hero", "Window Rim"]) {
    assert.equal(glassSpec(name, blend).skipMesh, true, `${name} is a named veil`);
  }
});
