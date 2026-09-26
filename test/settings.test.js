import assert from "node:assert/strict";
import test from "node:test";
import {
  exportFilename,
  exportFormatExt,
  exportFormatWord,
  exportIconKind,
  parseExportFormat,
  parseSettings,
  parseTextureSize,
  sanitizeName,
  savedHeadline,
  TEXTURE_SIZE_OPTIONS,
} from "../src/lib/settings.js";

test("parseSettings defaults match product defaults", () => {
  assert.deepEqual(parseSettings(undefined), {
    askWhereToSave: false,
    debugZip: false,
    exportFormat: "glb",
    maxTextureEdge: 0,
    includeViewerScene: true,
    uidInFilename: true,
    pageToasts: true,
  });
});

test("parseSettings drops keys from removed settings", () => {
  // Older installs may still store alwaysShowCardDownload.
  assert.equal("alwaysShowCardDownload" in parseSettings({ alwaysShowCardDownload: true }), false);
});

test("parseSettings accepts texture caps and opt-outs", () => {
  assert.deepEqual(
    parseSettings({
      askWhereToSave: true,
      debugZip: 1,
      exportFormat: "gltf-zip",
      maxTextureEdge: 2048,
      includeViewerScene: false,
      uidInFilename: false,
      pageToasts: false,
    }),
    {
      askWhereToSave: true,
      debugZip: true,
      exportFormat: "gltf-zip",
      maxTextureEdge: 2048,
      includeViewerScene: false,
      uidInFilename: false,
      pageToasts: false,
    }
  );
  assert.equal(parseTextureSize(4096), 4096);
  assert.equal(parseTextureSize(1234), 0);
  assert.equal(parseTextureSize("2048"), 0);
  assert.equal(parseExportFormat("gltf-zip"), "gltf-zip");
  assert.equal(parseExportFormat("glb"), "glb");
});

test("sanitizeName strips unsafe characters", () => {
  assert.equal(sanitizeName("2010 Citroën DS Survolt"), "2010_Citro_n_DS_Survolt");
  assert.equal(sanitizeName(""), "model");
});

test("exportFilename and labels follow settings", () => {
  assert.equal(
    exportFilename({ name: "Car", uid: "abcdef12xxxx", uidInFilename: true }),
    "Car-abcdef12.glb"
  );
  assert.equal(
    exportFilename({
      name: "Car",
      uid: "abcdef12xxxx",
      uidInFilename: false,
      exportFormat: "gltf-zip",
    }),
    "Car-gltf.zip"
  );
  assert.equal(
    exportFilename({ name: "Car", uid: "abcdef12xxxx", debugZip: true }),
    "Car-abcdef12-debug.zip"
  );
  assert.equal(
    exportFilename({ name: "Car", uid: "abcdef12xxxx", sourceZip: true }),
    "Car-abcdef12-source.zip"
  );
  assert.equal(
    exportFilename({ name: "Car", uid: "abcdef12xxxx", uidInFilename: false, sourceZip: true }),
    "Car-source.zip"
  );
  // The GLB inside a debug bundle, named from the already-shortened uid.
  assert.equal(exportFilename({ name: "Car", uid: "abcdef12" }), "Car-abcdef12.glb");
  assert.equal(
    exportFilename({ name: "failed", uid: "abcdef12xxxx", debugZip: true }),
    "failed-abcdef12-debug.zip"
  );
  assert.equal(exportFormatWord({ exportFormat: "glb" }), "GLB");
  assert.equal(exportFormatWord({ exportFormat: "gltf-zip" }), "glTF");
  assert.equal(exportFormatExt({ exportFormat: "glb" }), ".glb");
  assert.equal(exportFormatExt({ exportFormat: "gltf-zip" }), ".gltf");
  assert.equal(exportIconKind({ exportFormat: "glb" }), "glb");
  assert.equal(exportIconKind({ exportFormat: "gltf-zip" }), "gltf");
  assert.equal(exportFormatWord({ debugZip: true }), "Debug ZIP");
  assert.equal(savedHeadline({ filename: "a.glb" }), "GLB ready");
  assert.equal(savedHeadline({ filename: "a-gltf.zip" }), "glTF ready");
  assert.equal(savedHeadline({ filename: "a-debug.zip" }), "Debug ZIP saved");
  assert.equal(savedHeadline({ filename: "a-source.zip" }), "ZIP saved");
  assert.equal(TEXTURE_SIZE_OPTIONS.length, 2);
  assert.equal(TEXTURE_SIZE_OPTIONS[0].value, 4096);
  assert.equal(TEXTURE_SIZE_OPTIONS[0].label, "4K");
  assert.equal(TEXTURE_SIZE_OPTIONS[0].hint, "4096px");
  assert.equal(TEXTURE_SIZE_OPTIONS[1].value, 2048);
  assert.equal(TEXTURE_SIZE_OPTIONS[1].label, "2K");
  assert.equal(TEXTURE_SIZE_OPTIONS[1].hint, "2048px");
});
