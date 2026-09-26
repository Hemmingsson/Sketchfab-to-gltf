import test from "node:test";
import assert from "node:assert/strict";
import { isMilestoneStage, stageMilestone } from "../src/lib/milestones.js";
import { isLogRowVisible } from "../src/lib/log-view.js";

const t = (ms, bytes) => ({ startedAt: 1_000, now: 1_000 + ms, bytes });

test("stageMilestone copy for decrypt / textures / convert", () => {
  assert.deepEqual(stageMilestone("decrypting", "textures", t(2_340)), {
    kind: "separator",
    text: "Decrypted · 2.3s",
  });
  assert.equal(stageMilestone("decrypting", "textures", t(2_340, 1_153_433)).text, "Decrypted · 1.1 MB · 2.3s");
  assert.equal(stageMilestone("textures", "packing", t(6_790)).text, "Textures ready · 6.8s");
  assert.equal(stageMilestone("converting", "saving", t(1_900, 46_032_486)).text, "GLB built · 43.9 MB · 1.9s");
  assert.equal(stageMilestone("decrypting", "converting", t(500)).text, "Decrypted · 0.5s");
  assert.equal(stageMilestone("textures", "converting", t(0)).text, "Textures ready · 0.0s");
  assert.equal(stageMilestone("converting", "done", t(1_000)).text, "GLB built · 1.0s");
  assert.equal(stageMilestone("textures", "packing", { startedAt: 5_000, now: 4_000 }).text, "Textures ready · 0.0s");
  assert.equal(stageMilestone("converting", "saving", t(1_000, 0)).text, "GLB built · 1.0s");
});

test("stageMilestone is null off the three stages, on reset, error, or ZIP fallback", () => {
  assert.equal(stageMilestone("converting", "error", t(1_000)), null);
  assert.equal(stageMilestone("textures", "error", t(1_000)), null);
  assert.equal(stageMilestone("reading", "decrypting", t(1_000)), null);
  assert.equal(stageMilestone("packing", "converting", t(1_000)), null);
  assert.equal(stageMilestone("saving", "done", t(1_000)), null);
  assert.equal(stageMilestone("textures", "textures", t(1_000)), null);
  assert.equal(stageMilestone("textures", "queued", t(1_000)), null);
  assert.equal(stageMilestone("converting", "zipping", t(1_000)), null);
});

test("milestone separators stay visible; only the three stages count", () => {
  for (const entry of [
    stageMilestone("decrypting", "textures", t(2_340)),
    stageMilestone("textures", "packing", t(6_790)),
    stageMilestone("converting", "saving", t(1_900, 46_032_486)),
  ]) {
    assert.equal(isLogRowVisible(entry, "summary"), true);
    assert.equal(isLogRowVisible(entry, "raw"), true);
  }
  assert.equal(isMilestoneStage("decrypting"), true);
  assert.equal(isMilestoneStage("textures"), true);
  assert.equal(isMilestoneStage("converting"), true);
  assert.equal(isMilestoneStage("packing"), false);
  assert.equal(isMilestoneStage("saving"), false);
});
