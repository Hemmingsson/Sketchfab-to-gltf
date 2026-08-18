# Plan: Apply code-review findings to the Sketchfab downloader extension

## Context

Two evaluator agents reviewed the extension and produced one consolidated report (both
attachments are identical) with **14 findings**: 3 critical, 5 important, 6 minor. A fresh
exploration of the current code **confirmed all 14** against live line numbers (the report's
line numbers were mostly stale but the issues are real).

This plan is written for an **orchestrator agent** that keeps only a small working context
(task list + progress + delegation state). It delegates each unit of work to an
**implementer subagent**, then to an independent **validator subagent**. When both report
clean, the orchestrator records "done" and moves to the next task **without absorbing the
subagent's detailed output** — it only needs PASS/FAIL + a one-line note.

Goal: ship a hardened, spec-correct extension with no behavior regressions.

### Project facts (for every subagent prompt)
- Plain **unbundled MV3 ES modules** — no bundler, no build step. Load via `chrome://extensions` → Load unpacked.
- Tests: `npm test` → `node --test test/*.test.js` (Node built-in runner, Node 18+). Tests cover the `lib/` engine only (no Chrome APIs, no DOM).
- **No ESLint / no lint step.**
- Import graph: `background.js` imports nothing from `lib/`; `offscreen/offscreen.js` → `lib/pipeline.js` is the only engine entry; `content/panel.js` and `popup/popup.js` are pure message-passing.

### Decisions locked with the user
- **#3 download path:** keep the blob URL as the **primary** path; add a **data-URL fallback only when `chrome.downloads.download` reports an error**. Do NOT do a full data-URL rewrite (base64 is memory-heavy for large 4K packs).
- **#7 progress badge:** **include it** (`chrome.action.setBadgeText`).
- **#11 DEBUG flag:** **leave as-is** (no change — do not touch DEBUG).
- **#5 permissions:** remove **`activeTab`** only; **keep `tabs`** (used by `chrome.tabs.sendMessage`).

---

## Task breakdown (4 file-disjoint tasks → safe to run in parallel)

Each task owns a fixed, non-overlapping set of files, so implementers can run concurrently
without merge conflicts. #11 (DEBUG) is intentionally excluded everywhere per the decision above.

### Task 1 — `manifest.json` hardening  (findings #2, #5, #6, + the `alarms` line for #1)
Owns: **all of** `manifest.json` (so Tasks 1 and 4 never both touch it — see Dependencies).
- **#2 (critical):** remove the entire `web_accessible_resources` block. `lib/*.js` and `decrypt.wasm` are loaded by the offscreen extension page, not by the Sketchfab page, so exposing them via WAR is unnecessary and leaks the decrypt/descramble source to page JS.
- **#5 (important):** remove `"activeTab"` from `permissions` (confirmed unused). **Keep `"tabs"`** (used by `chrome.tabs.sendMessage` at `background.js:110`).
- **#6 (important):** add `"minimum_chrome_version": "116"`. Justified by a real API in use: `chrome.runtime.getContexts` at `background.js:167` (Chrome 116).
- **If #1 proceeds:** add `"alarms"` to `permissions` here (Task 1 owns every manifest edit; Task 4 only writes `background.js`/`offscreen.js`).
- Validator must load the unpacked extension and confirm the offscreen pipeline still fetches `lib/wasm/decrypt.wasm` after WAR removal (it should — extension-page fetch — but this is the one subtle break risk).

### Task 2 — `content/panel.js` polish  (findings #4, #13, #14)
Owns: `content/panel.js`
- **#4 (important):** replace the `setInterval(..., 500)` href-poll (currently ~line 186–193) with the Navigation API, **feature-detected with the poll kept as fallback** to avoid a silent SPA-nav regression if the isolated world doesn't expose it: `if (window.navigation) navigation.addEventListener("navigate", () => syncToPage()); else <keep the existing interval>`. Do NOT blindly delete the interval — gate it behind the feature check.
- **#13 (minor):** append the button to `document.body` instead of `document.documentElement` (currently ~line 125). Content script runs at `document_idle`, so `body` exists.
- **#14 (minor):** in the `onClick` handler (~line 82–97), attach `.catch(...)` to the `chrome.runtime.sendMessage(...)` promise — the surrounding `try/catch` does not catch its async rejection. Mirror the `.catch` already used in `syncToPage`.

### Task 3 — `lib/` engine: CRC32 dedup + PNG decode order  (findings #8, #10)
Owns: `lib/descramble.js`, `lib/zip.js`, and (new) `lib/crc32.js`; may update `test/zip.test.js` import path.
- **#10 (minor):** deduplicate the two CRC32 implementations. Extract one shared module `lib/crc32.js` exporting the **offset-capable** form `crc32(u8, start, len)`. Have `zip.js` and `descramble.js` import from it. **Caveat:** `zip.js`'s current export is `crc32(data)` (whole-buffer); `descramble.js` calls the sliced form. Preserve both call sites correctly (adapt the whole-buffer call to `crc32(data, 0, data.length)` or keep a thin wrapper). `test/zip.test.js` imports `crc32` from `zip.js` — keep that import working (re-export from `zip.js` or update the test import).
- **#8 (important — RECONSIDER / likely narrow or defer):** the report frames "custom PNG parser first" as a perf miss, but the current order (`decodeToRgba`, `descramble.js:536`) is **defensible on correctness grounds**: the custom `decodePngRgba` yields exact, lossless RGBA, whereas `decodeViaBitmap` (line 512) round-trips through `createImageBitmap`→canvas `getImageData` with **default premultiply + color-space conversion**, which is lossy for alpha and can corrupt exact channel values in ORM/normal/roughness maps. **Critically, `npm test` cannot catch a regression here**: Node has no `ImageDecoder`/`createImageBitmap`/`OffscreenCanvas`, so tests always hit the custom parser regardless of order.
  - **Recommended:** if pursued at all, only prefer **`ImageDecoder`** (its `copyTo({format:"RGBA"})` at line 496 is exact) over the custom parser, and leave `decodeViaBitmap` last. Do **not** move the lossy canvas path ahead of the custom parser. Any change requires **manual before/after pixel comparison in the browser** on a real model with alpha + ORM textures — otherwise defer #8.
- Validator runs `npm test` — `zip.test.js`, `descramble.test.js`, `orm.test.js` must all pass (covers #10 only; #8's decode order is not exercised in Node).

### Task 4 — `background.js` + `offscreen/offscreen.js`: SW robustness, download, badge  (findings #1, #3, #7, #9, #12)
Owns: `background.js`, `offscreen/offscreen.js`
- **#1 (critical → VERIFY FIRST, premise is questionable):** the report says "`setInterval` can't wake a dead SW." True, but this timer (`startKeepAlive`, `background.js:124–131`) is a *keep-alive*, not a *waker* — and its `chrome.runtime.getPlatformInfo()` call resets the 30s idle timer every 20s, which is the standard, working MV3 pattern; incoming offscreen progress messages reset it too. A naive swap to `chrome.alarms` is a **regression risk**: the minimum alarm period in a released extension is 30s, which is ≥ the 30s idle timeout, so it may fail to keep the SW alive during silent phases. **Do not blindly swap.** Have the implementer first reproduce an actual SW-death-during-download failure; if none, leave the `setInterval` keepalive as-is (and drop the `"alarms"` permission from Task 1). If a real failure exists, prefer a hybrid (keep `setInterval` for keep-alive; add an alarm only as a wake backstop) over replacing the timer.
- **#3 (critical, per decision):** keep the current blob-URL download as primary. In `saveJob` (`background.js:266`), fall back to a data URL when the blob download fails — but note the failure can surface **two ways**, both must trigger the fallback: (a) the `chrome.downloads.download` callback with `lastError`/no `downloadId` (already handled at line 277), and (b) later via `chrome.downloads.onChanged` → `state: "interrupted"` (currently routed to `finishSave` → hard error at line 358). The fallback: ask `offscreen.js` for the raw bytes of that job id, build a chunked-base64 `data:<mime>;base64,...` URL in the SW, and retry `chrome.downloads.download` once before failing. **Offscreen change required:** today `offscreen.js` retains only the object URL (`blobUrls`, line 55), not the bytes — it must also retain the `Blob`/bytes per id (freed on revoke/confirm) so it can answer a `refetchBytes` request. Note the memory cost: the full file is held until the download is confirmed. Keep the existing revoke/120s-timeout flow for the primary blob path.
- **#7 (important, per decision):** add `chrome.action.setBadgeText` progress feedback (e.g. active-job count or % ) and clear it when the queue drains.
- **#9 (minor):** remove `"WORKERS"` from the offscreen `reasons` array (`background.js:176`); keep `"BLOBS"`. `reasons` are declarative justifications, not capability grants, so this is cosmetic — but confirm the pipeline spawns no `Worker` before removing.
- **#12 (minor):** remove the `typeof chrome.downloads.search === "function"` guard (~line 320); call it directly.
- **Do not touch `DEBUG`** in either file.

---

## Orchestration protocol (how the orchestrator runs this)

Keep main context minimal. For **each task**:

1. **Delegate implementation.** Dispatch an implementer subagent (`task-implementer` or
   `claude`) with: the project facts block above, the task's exact findings + file ownership,
   the locked decisions, and the instruction: *implement, then run `npm test`, then
   self-review the diff; report back only `PASS`/`FAIL` + a one-line summary + the list of
   files changed.*
2. **Delegate validation.** Dispatch an independent validator subagent (`code-reviewer`)
   scoped to that task's files/diff. It re-runs `npm test`, checks the finding was actually
   fixed, checks for regressions and MV3 correctness, and reports `PASS`/`FAIL` + at most a
   few lines.
3. **Gate.** If implementer = PASS **and** validator = PASS → record the task done, discard
   the details, move on. If either = FAIL → dispatch a focused fix subagent with only the
   specific failure, then re-validate. Do not re-read everything.

**Parallelization:** Tasks 1–4 are **fully file-disjoint** (Task 1 owns *all* of `manifest.json`,
including the `"alarms"` line; Task 4 writes only `background.js`/`offscreen.js`), so they may be
dispatched **concurrently** (one message, multiple implementer subagents), then validated
concurrently. No cross-task file conflict remains.

**What the orchestrator retains:** a checklist of the 14 findings mapped to tasks, and each
task's PASS/FAIL state. Nothing else.

---

## Verification

**Automated (subagents can run):**
- `npm test` after every task — must stay green (directly exercises #8, #10 via
  `zip.test.js`, `descramble.test.js`, `orm.test.js`).

**Manual smoke test (final gate — the user runs this; subagents cannot load Chrome + Sketchfab):**
Load unpacked in `chrome://extensions`, open a **public** Sketchfab model, then confirm:
1. The ⬇ button appears (on `document.body` now) — **#13**.
2. Navigate between models via SPA links — the button re-syncs without the old 500ms poll — **#4**.
3. Click download — a real file lands on disk (primary blob path) — **#3 primary**.
4. Badge text shows progress during download and clears after — **#7**.
5. Extension loads with no manifest errors after WAR removal and the Chrome-116 floor — **#2, #6**.
6. Long-idle then trigger a download — SW wakes via alarm and completes — **#1**.
7. (Optional) Force a `downloads.download` error to exercise the **data-URL fallback** — **#3 fallback**.

Optional: the `chrome-devtools` MCP is available and could automate part of the smoke test,
but driving a real Sketchfab download is heavy — the manual checklist is the pragmatic gate.

## Findings → task map (orchestrator checklist)
- Task 1 (manifest): #2, #5, #6 (+ `alarms` line only if #1 proceeds)
- Task 2 (panel.js): #4, #13, #14
- Task 3 (lib): #8 (narrow/defer), #10
- Task 4 (background+offscreen): #1 (verify first), #3, #7, #9, #12
- Excluded by decision: #11 (DEBUG left as-is)

---

## Plan validation (review)

**Verdict: ready with edits.** All 14 findings verified against live code (line numbers refreshed).
The edits above tighten four items that the raw report over-rated or under-specified; the rest are
sound and low-risk.

### Reuse
- No new subsystems needed. #10 extracts one shared `lib/crc32.js` from two existing copies — pure dedup.
- #7 uses the already-declared `action` key (`manifest.json:11`), so `chrome.action.setBadgeText` works with no manifest change.
- The codebase already mirrors jobs to `storage.session` + rehydrates on SW restart (`background.js:117,415`) — relevant to #1 (see below); no new persistence layer required.

### Simplicity / scope
- #8 is the main over-reach: framed as a perf optimization, but the current "custom parser first" order is a **correctness** choice (exact lossless RGBA vs the lossy `createImageBitmap`→canvas round-trip). **Narrowed** to "prefer `ImageDecoder` only, never the canvas path; else defer." No scope creep elsewhere.
- #1 **premise is questionable** — the `setInterval` keepalive is the standard working MV3 pattern and a blind `chrome.alarms` swap can regress it (30s min period ≥ 30s idle). Reframed to "verify a real failure first; prefer hybrid over replace."
- #3 fallback intentionally kept minimal (one retry via data URL), not a full rewrite, per the locked decision.

### Correctness gaps caught
- **#3 trigger:** the blob failure can surface via `downloads.onChanged` → `interrupted` (`background.js:358`), not only the `download()` callback — the fallback must cover **both** paths, and `offscreen.js` must be changed to retain raw bytes (it currently keeps only the object URL). Documented in Task 4.
- **#4:** Navigation-API availability in the isolated world is not guaranteed enough to delete the poll outright — changed to feature-detect + keep the interval as fallback.
- **#6:** `minimum_chrome_version: 116` is correctly justified by real usage of `chrome.runtime.getContexts` (`background.js:167`).
- **#2:** WAR removal is safe (content script imports nothing from `lib/`; offscreen loads `lib/` + `decrypt.wasm` as an extension page) — but flagged for a mandatory load-and-download check because a broken WASM fetch would be the one silent failure.

### Dependencies / ordering
- Reassigned **all** `manifest.json` edits (including the `alarms` line) to Task 1, making Tasks 1–4 fully file-disjoint → safe to run **in parallel**. No sequencing constraint remains.
- Within Task 3, `test/zip.test.js` imports `crc32` from `zip.js`; keep `zip.js` re-exporting from the new `lib/crc32.js` (or update the test import) so tests stay green.

### Verification / testability
- `npm test` only exercises the `lib/` engine — it validates **#10** directly and **cannot** validate #8's decode order (Node lacks `ImageDecoder`/`createImageBitmap`). Every Chrome-runtime finding (#1–#7, #12–#14) needs the **manual smoke-test checklist**; that checklist is the real gate, not the unit tests. Called out explicitly so the orchestrator doesn't treat green tests as "done."
- Observability: DEBUG logging stays on (per decision), so the SW/offscreen consoles remain the primary post-ship failure signal — adequate for this manual-verified extension.

### Recommended execution order for the orchestrator
1. Dispatch Tasks 1–4 implementers **in parallel** (disjoint files).
2. For **#1** and **#8**, the implementer must *verify the premise first* and is allowed to return "no change — premise did not hold" as a valid PASS.
3. Validate each task (re-run `npm test`, review diff).
4. **User runs the manual smoke-test checklist** — this is the true gate for the download path (#3), SW keepalive (#1), badge (#7), WAR removal (#2), and SPA nav (#4).
