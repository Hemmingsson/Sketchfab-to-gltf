# Sketchfab Public Downloader

A Chrome (Manifest V3) extension that downloads **public** Sketchfab models as a single, self-contained **glTF `.glb`** (mesh + PBR textures embedded). No account, no API key.

## How it works

1. Open a public Sketchfab model page. A blue **⬇** button appears in the bottom-right corner.
2. Click it. The button shows preparation progress (`0%…100%`), then turns **green ✓** when the file is saved.
3. The `.glb` is saved **silently** to your Downloads folder (no Save-As dialog).

The work runs in the **background**, so you can navigate away or close the page and the download still completes. Click the toolbar icon to see a **dashboard** of all current and past downloads — each with a progress bar and an expandable log, and a link back to the model to retry.

## What it does under the hood

Everything is derived from the public viewer page (no login/cookies — all fetches are anonymous):

1. Read the public embed/viewer page → model id, materials, mesh URLs.
2. Extract the current static decrypt key from live Sketchfab JS.
3. Download and decrypt the `.binz` model files (WASM).
4. Download textures, **descramble** protected maps, and pack per-material ORM (occlusion/roughness/metallic) maps.
5. Convert osgjs → glTF and emit a single `.glb` with textures embedded.

If glTF conversion fails, it falls back to a small ZIP of the raw source files so a click never yields nothing.

## Install (developer mode)

1. Clone this repo.
2. Chrome → `chrome://extensions` → enable **Developer mode**.
3. **Load unpacked** → select this folder.
4. Open a public Sketchfab model page and click the ⬇ button.

## Permissions

| Permission | Why |
|---|---|
| `downloads` | Save the `.glb` |
| `storage` | Download history + in-flight state |
| `offscreen` | Decrypt / descramble / convert off the service worker (large texture packs) |
| Sketchfab host access | Public viewer data and CDN maps |

## Project layout

- `content/panel.js` — the injected corner button.
- `popup/` — the downloads dashboard.
- `background.js` — job registry, queue, and silent save.
- `offscreen/offscreen.js` — runs the pipeline off the service worker.
- `lib/` — the conversion engine (`pipeline`, `sf-api`, `decrypt` + `wasm/`, `descramble`, `orm`, `osgjs2gltf`, `zip`).
- `test/` — unit tests for the engine (`node --test test/*.test.js`).

## Legal

For personal use of **public** viewer data. Follow [Sketchfab Terms](https://sketchfab.com/terms) and each author's license. This tool descrambles Sketchfab's texture protection to reconstruct the maps; be aware that this may conflict with Sketchfab's Terms of Service.

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html) — see [LICENSE](LICENSE).
