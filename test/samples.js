/**
 * Fixture models under `.context/samples/` are local-only (not in git). Tests
 * that read them pass `needsSamples` as their node:test options so a fresh
 * clone reports them as skipped instead of failing with ENOENT.
 *
 * Not named `*.test.js` on purpose: `node --test test/*.test.js` must not pick
 * this file up as a suite.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Directory the fixture models live in. */
export const samples = join(root, ".context/samples");

/** `{ skip: reason }` when the fixtures are absent, otherwise no options. */
export const needsSamples = existsSync(samples)
  ? {}
  : { skip: "no .context/samples/ — fixture models are local-only (see AGENTS.md)" };
