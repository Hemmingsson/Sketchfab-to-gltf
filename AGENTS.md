# Sketchfab to glTF

Chrome extension (Manifest V3) built with WXT + Svelte 5 + TypeScript. Load the built output unpacked — not the repo root. `src/lib` stays plain JS so unit tests run without a build. The playground is a Vite preview of the UI on a mock backend; it never talks to Chrome.

## Commands

From the repo root (pnpm only):

- `pnpm install` — install deps (runs `wxt prepare` via postinstall)
- `pnpm dev` — WXT watch build → `.output/chrome-mv3-dev`
- `pnpm build` — production build → `.output/chrome-mv3`
- `pnpm check` — `wxt prepare` + `svelte-check`
- `pnpm test` — `node --test test/*.test.js`. Pure `src/lib` only. No Chrome.
- One file: `node --test test/materials.test.js`
- `pnpm playground` — UI preview on the mock backend
- `pnpm playground:build`
- `pnpm zip` — pack the extension zip (`.output/*-chrome.zip`)
- Pipeline diagram: edit `docs/diagrams/pipeline.spec.json`, then `python3 docs/diagrams/build.py` (needs `pip install hyperweave`). Never hand-edit `pipeline.svg`; the next build overwrites it.
- README demo video: edit `demo-video/index.html` (HyperFrames composition), then `pnpm demo:export` (needs `ffmpeg` and `img2webp` from `brew install ffmpeg webp`; the renderer is `npx hyperframes@0.8.77`, and the page loads GSAP from a CDN, so both need network). It rewrites `docs/demo.webp` only (animated WebP for the README; no WebM/MP4 deliverable). Wallpaper is `demo-video/assets/aurora.webp`. The popup in the video is hand-mirrored from `src/components`: re-sync its markup and copy when the UI changes. Every frame is `renderAt(t)`, a pure function of time: no `setTimeout`, `Date.now`, `Math.random`, or CSS `@keyframes`. Preview a beat with `npx hyperframes@0.8.77 snapshot demo-video --at 4.8`.
- Feature clips (16:9, one per injected button): edit `demo-video/clips.html` (`clip` variable: `model` | `cards` | `collection`), then `pnpm demo:clips [clip…]`. Writes `docs/clips/<name>.webp` (1280×720, 60fps, 4 s loop: cursor in, click, 0→100% in 1 s, out), shown side by side in the README under Use. No browser chrome; the page gets the main demo's squircle corners on transparent. Models are shaded primitives (CSS 3D cube on the model page, SVG shapes on cards); page text is skeleton bars, so the only copy is the extension's own (button, tooltip, toast). Preview in a browser with `clips.html?clip=cards` and `window.__renderAt(t)`.

**Load unpacked:** `chrome://extensions` → Load unpacked → `.output/chrome-mv3` (or `.output/chrome-mv3-dev` while `pnpm dev` runs). Reload after `pnpm build`. `pnpm dev` reloads by itself. End users: download `*-chrome.zip` from [Releases](https://github.com/Hemmingsson/Sketchfab-to-gltf/releases), unzip, Load unpacked.

**Ship a release:** bump `version` in `package.json`, commit, tag `vX.Y.Z`, push the tag. `.github/workflows/release.yml` checks the tag against `package.json`, runs `pnpm test` and `pnpm zip`, and attaches the zip to the GitHub Release. `.github/workflows/ci.yml` runs test + check + build on every push and pull request.

Fixture tests read `.context/samples/` (local, not in git, and not redistributable). Without it they report as skipped via `test/samples.js`, so `pnpm test` stays green on a fresh clone. Do not delete those tests or invent stand-in models.

## Where code goes

```text
/
  package.json  pnpm-lock.yaml  wxt.config.ts  tsconfig.json
  .github/workflows/
    ci.yml                        # push / PR → test + check + build
    release.yml                   # tag v* → zip → GitHub Release
  public/
    icon-16.png icon-48.png icon-128.png
    lib/wasm/decrypt.wasm          # byte-identical; leave alone
  src/
    entrypoints/                  # src/entrypoints — WXT entry points
      background.ts               # all runtime code inside main()
      offscreen/index.html  offscreen/main.ts   # built as /offscreen.html
      popup/index.html  popup/main.ts  popup/popup.css
      sketchfab.content/
        index.ts                  # page / card / collection buttons + toaster
        placement.ts              # find Sketchfab DOM hooks
        page-button-styles.ts     # light-DOM styles for those buttons
    components/                   # Svelte UI (popup + page)
    shared/
      types.ts                    # JobPhase and shared types (single source)
      messages.ts                 # message + storage-key contracts (re-exports settings parsers)
      store.svelte.ts             # app state; backend injected via setBackend()
      format.ts  job-toasts.ts  chrome-backend.ts
      tokens.css                # custom properties only — the content script imports this
      popup-ui.css              # popup utility classes (popup + playground import it)
      view-transition.ts        # popup list ↔ detail (names rows at runtime)
      view-transitions.css      # document-level VT CSS (import from popup / playground only)
    lib/                          # conversion engine (plain JS). pipeline.js is the entry
      settings.js                 # settings parsers + export filenames (single source)
      model-url.js                # modelUid + collectionUid
      collection.js               # list public collection model URLs
      descramble.js  png.js       # unscramble CDN textures; PNG decode / encode
  playground/                     # mock backend UI; never imports chrome-backend
    index.html  main.ts  App.svelte      # the preview itself
    tuner.html  tuner.ts  transition-tuner.ts  # view-transition timing, driven by Theatre.js
  demo-video/                     # README media (HyperFrames): index.html → demo, clips.html → clips
  test/                           # imports ../src/lib/...; samples.js gates fixture tests
  docs/
    demo.webp  clips/             # README media, rewritten by the demo scripts
    diagrams/                     # pipeline.spec.json → pipeline.svg (build.py)
```

## Rules that are easy to break

The queue is single-flight. A second concurrent pipeline OOMs the offscreen document on a 4K texture pack. The keepalive tick fails a running job whose offscreen document is gone or silent for `STALL_MS`, and closes the document first, so a hung pipeline never overlaps the next job. Collection download enqueues many jobs; they still run one at a time.

`downloads.onChanged` fires for the user's own downloads too. Match a save by its download id or URL (`jobForDownload`), never by "whichever job is saving".

Background-only job state (tabs, save-as, fallback, download id) lives in the `states` map, not on `DownloadJob`. Jobs are broadcast and stored as-is.

URL parsers live in `src/lib/model-url.js`: `modelUid()` (strict model-page URL) and `collectionUid()`. `extractUid` in `sf-api.js` builds on `modelUid` and also accepts a bare uid. Collection listing is `collectionModelUrls` in `collection.js` (anonymous `i/collections` API).

Settings parsing and export naming live in `src/lib/settings.js`: `parseSettings` (re-exported by `messages.ts` for TypeScript callers) and `exportFilename`, which names every saved file including the source and debug ZIPs. Do not duplicate defaults or build a filename by hand.

Progress is a phase, not a byte count. Offscreen classifies a log line into a phase; background animates `pct` up to `PHASE_CEIL`. Do not emit per-texture percentages. Round `pct` in the UI (`Math.round`).

Smoother ticks send `jobPatch` (`id`, `pct`, `updatedAt`, no log) via `broadcastPct`; everything else sends the full job (`broadcastJob`). Receivers apply patches with `patchJob` and drop stale or unknown ones. Progress lines mirror to session storage through `mirrorSessionSoon` (coalesced); lifecycle changes call `mirrorSession` directly.

`descrambleImageBytes` runs one image at a time (decode → descramble → encode) and uses `descrambleRgbaAsync`, which yields every 256 rows (never `setTimeout`: the offscreen doc is hidden and throttled). `buildZip` deflates 2 files at a time; entry order stays the input order.

`chrome.runtime.sendMessage` reaches the popup, not the content script. Push page-button updates with `chrome.tabs.sendMessage` to the tab that started the job. A popup retry does not update the page button live.

Content script: `syncToPage()` is the only reconciler for page, card, and collection download buttons. Buttons mount into Sketchfab’s light DOM (no wrapper) and are tagged `data-sf-dl="page" | "card" | "collection"` — the hook they sit in, not the export format; styles come from `page-button-styles.ts`. Card buttons use `.card-model[data-uid]`; collection button uses `.collection-actions`.

Fetches stay anonymous. No cookies, no Sketchfab login, no API key, no new host permissions.

`debugZip` is a setting (default off). When on, the pipeline saves a debug ZIP instead of the chosen export format.

`exportFormat` is a setting (`"glb"` default, or `"gltf-zip"`). When `"gltf-zip"`, the pipeline zips the converter's external package (`model.gltf` + `model.bin` + `textures/`).

`maxTextureEdge` is a setting (`0` = original / none selected, or `2048` / `4096`). Caps the CDN texture variant picked for download and ORM packing. Settings UI title is Max Texture Size; options are exclusive 4K / 2K checkboxes with px hints; deselect both for original.

`includeViewerScene` (default on) embeds Sketchfab viewer camera + punctual lights. Off keeps unlit/shading flags but drops camera and lights.

`uidInFilename` (default on) builds `name-uid8.ext`; off uses `name.ext`.

`pageToasts` (default on). Off skips content-script toasts (popup history still updates).

Collection "Download all" jobs carry `job.batch` (`src/lib/batch.js`). A batch shows one page toast per run, never opens Save-as (it saves to `Downloads/<collection>/`), and history is uncapped (`unlimitedStorage`). The content script loads history with `getJobs { lite }` (finished jobs without logs).

If glTF conversion throws, still return a ZIP of the raw mesh files (textures omitted). A click must not yield an empty save.

The phase list lives only in `src/shared/types.ts`. Do not duplicate it elsewhere.

Background: WXT imports `background.ts` in Node at build time. Put all runtime code inside `main()`. `main()` must not be async. Only imports and types sit at top level.

Never pass a `$state` proxy to a chrome API (messages, storage). Use `$state.snapshot()`.

Shadow-root CSS: `tokens.css` holds only custom properties, because the content script imports it into a shadow root — popup utility classes belong in `popup-ui.css`. WXT rewrites `:root` to `:host` and adds `:host{all:initial !important}`. Custom properties survive; fonts and colors do not. Set `font-family: var(--font)` on each shadow component's root. `font: inherit` resolves to the browser default serif. Same-document view transitions (`view-transitions.css`) are document-level — import from popup/`playground` `main.ts`, never from a shadow root.

WASM lives at `public/lib/wasm/decrypt.wasm` (copied to the output root). Never change its bytes. Path for `chrome.runtime.getURL("lib/wasm/decrypt.wasm")` stays valid.

The offscreen document URL is `offscreen.html` at the extension root (WXT unlisted page), not a nested path.

The playground never imports `src/shared/chrome-backend.ts`. Inject `mockBackend` via `setBackend()`.

Keyed `{#each}` over logs needs unique ids — create entries only through `appendLog`. Cap is 500.

## Tests

`node:test` and `node:assert/strict`. Cover the pure function you changed (`osgjs2gltf`, materials, ORM, descramble, zip, animations, progress, settings, collection, model-url, log-groups). Do not add a Chrome mock to unit tests.

## Svelte conventions

Svelte 5 runes. Shared state is `export const app = $state(...)` in `src/shared/store.svelte.ts`. Components read `app`; they do not keep a second job list. Data source is injected with `setBackend()`: `chromeBackend` in popup/content, `mockBackend` in the playground. Components never touch `chrome.*`.

```svelte
<button type="button" onclick={goSettings}>
```

Use `onclick`, not `on:click`. Toasts (`svelte-sonner`) mount on the page (content script / playground stage), not inside the popup. Relative imports in `src/components` and `src/shared`; the playground has no `@/` alias. After editing `.svelte` / `.svelte.ts`, run the Svelte autofixer until clean.

## Do not

- Edit or regenerate `public/lib/wasm/decrypt.wasm`.
- Use npm or yarn (pnpm only).
- Commit `.output/`, `.wxt/`, `node_modules/`, `playground/dist/`, `*.zip`, or `.context/`.
- Add a root `package-lock.json` or `svelte.config.js`.
