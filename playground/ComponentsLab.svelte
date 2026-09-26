<script lang="ts">
  import { toast } from "svelte-sonner";
  import { Download } from "@jis3r/icons";
  import { stageMilestone } from "../src/lib/milestones.js";
  import { savedHeadline } from "../src/lib/settings.js";
  import DownloadRow from "../src/components/DownloadRow.svelte";
  import EmptyState from "../src/components/EmptyState.svelte";
  import ExportFormatCards from "../src/components/ExportFormatCards.svelte";
  import TextureSizeCards from "../src/components/TextureSizeCards.svelte";
  import LogMarker from "../src/components/LogMarker.svelte";
  import PageDownloadButton from "../src/components/PageDownloadButton.svelte";
  import ProgressBar from "../src/components/ProgressBar.svelte";
  import Spinner from "../src/components/Spinner.svelte";
  import type { ExportFormat, TextureSize } from "../src/shared/types";
  import { createSeedJobs, logEntry } from "./seed";

  const samples = createSeedJobs();
  const [active, done, failed] = samples;

  let demoFormat = $state<ExportFormat>("glb");
  let demoSize = $state<TextureSize>(0);
  let demoSwitch = $state(true);

  const demoFile = $derived(demoFormat === "gltf-zip" ? "demo-gltf.zip" : "demo.glb");
  const doneHeadline = $derived(savedHeadline({ filename: demoFile }));

  const logNormal = logEntry("reading", "Reading public viewer…", { active: true });
  const logSeparator = logEntry(
    "separator",
    stageMilestone("converting", "saving", {
      startedAt: 0,
      now: 1900,
      bytes: 8_500_000,
    })!.text
  );
  const logStacked = $derived(logEntry("done", `Saved ${demoFile}`));
  const logStackedFail = logEntry("error", "Download failed");
  const logNested = [
    logEntry("texture", "Downloading textures…"),
    logEntry("detail", "1/4 Hull_D.png (2048×2048)", { depth: 1, done: true }),
    logEntry("detail", "2/4 Hull_N.png (2048×2048)", { depth: 1, done: true }),
    logEntry("detail", "3/4 Wood_D.jpg (1024×1024)", { depth: 1, active: true }),
    logEntry("detail", "4/4 Wood_N.jpg (1024×1024)", { depth: 1 }),
  ];

  const phaseMarkers = [
    logEntry("queued", "Queued"),
    logEntry("reading", "Reading public viewer…", { active: true }),
    logEntry("decrypt", "Decrypting"),
    logEntry("texture", "Textures"),
    logEntry("pack", "Packing"),
    logEntry("convert", "Converting"),
    logEntry("zip", "Zipping"),
    logEntry("save", "Saving"),
    logEntry("done", "Done"),
    logEntry("error", "Error"),
  ];
</script>

<div class="lab">
  <header class="lab-head">
    <h1>Components</h1>
  </header>

  <div class="grid">
    <div class="col">
      <section class="block">
        <h2>Export format</h2>
        <div class="frame pad">
          <ExportFormatCards
            value={demoFormat}
            onchange={(next) => (demoFormat = next)}
            name="lab-exportFormat"
          />
        </div>
      </section>

      <section class="block">
        <h2>Settings options</h2>
        <div class="frame pad settings-demo">
          <TextureSizeCards
            value={demoSize}
            onchange={(next) => (demoSize = next)}
            name="lab-maxTextureEdge"
          />
          <label class="switch-row">
            <span class="option-copy">
              <span class="option-label">Ask where to save</span>
              <span class="option-hint">Pick a folder each time</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={demoSwitch}
              onchange={(e) => (demoSwitch = e.currentTarget.checked)}
            />
          </label>
        </div>
      </section>

      <section class="block">
        <h2>Page download button</h2>
        <div class="frame pad row gap">
          <PageDownloadButton previewPhase="idle" />
          <PageDownloadButton previewPhase="done" />
        </div>
      </section>

      <section class="block">
        <h2>Progress</h2>
        <div class="stack">
          <ProgressBar value={64} />
          <ProgressBar value={100} tone="done" />
          <ProgressBar value={22} tone="error" />
        </div>
      </section>

      <section class="block">
        <h2>Spinner</h2>
        <div class="frame pad row">
          <Spinner size={16} />
        </div>
      </section>

      <section class="block">
        <h2>Download rows</h2>
        <div class="frame list">
          <DownloadRow job={active} static />
          <DownloadRow job={done} static />
          <DownloadRow job={failed} static />
          <DownloadRow
            job={{ ...done, id: "idle-prev", phase: "queued", pct: 0, name: "Queued sample" }}
            static
          />
        </div>
      </section>

      <section class="block">
        <h2>Empty</h2>
        <div class="frame">
          <EmptyState>
            {#snippet icon()}
              <Download size={18} />
            {/snippet}
          </EmptyState>
        </div>
      </section>
    </div>

    <div class="col">
      <section class="block">
        <h2>Phases</h2>
        <div class="frame pad phase-list">
          {#each phaseMarkers as entry (entry.id)}
            <LogMarker {entry} row />
          {/each}
        </div>
      </section>

      <section class="block">
        <h2>Log markers</h2>
        <div class="log-examples">
          <div class="frame pad">
            <p class="ex-label">Normal row (reading active)</p>
            <LogMarker entry={logNormal} />
          </div>
          <div class="frame pad">
            <p class="ex-label">Nested detail</p>
            {#each logNested as entry (entry.id)}
              <LogMarker {entry} />
            {/each}
          </div>
          <div class="frame pad">
            <p class="ex-label">Separator</p>
            <LogMarker entry={logSeparator} />
          </div>
          <div class="frame pad">
            <p class="ex-label">Stacked done</p>
            <LogMarker entry={logStacked} />
          </div>
          <div class="frame pad">
            <p class="ex-label">Stacked failed</p>
            <LogMarker entry={logStackedFail} />
          </div>
        </div>
      </section>

      <section class="block">
        <h2>Toasts</h2>
        <div class="row gap wrap">
          <button type="button" class="btn" onclick={() => toast("Queued", { description: "Model name" })}>
            Default
          </button>
          <button type="button" class="btn" onclick={() => toast.success(doneHeadline, { description: "Survolt" })}>
            Success
          </button>
          <button type="button" class="btn" onclick={() => toast.error("Download failed", { description: "Survolt" })}>
            Error
          </button>
          <button
            type="button"
            class="btn"
            onclick={() =>
              toast("History cleared", {
                action: { label: "Undo", onClick: () => toast.success("Restored") },
              })}
          >
            With undo
          </button>
        </div>
      </section>
    </div>
  </div>
</div>

<style>
  .lab {
    padding-bottom: 48px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px;
    align-items: start;
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .frame :global(.empty) {
    min-height: 200px;
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
  }

  .row {
    display: flex;
    align-items: center;
  }

  .gap {
    gap: 12px;
  }

  .wrap {
    flex-wrap: wrap;
  }

  .log-examples {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .phase-list {
    display: flex;
    flex-direction: column;
  }

  .ex-label {
    margin: 0 0 6px;
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.02em;
  }

  .settings-demo {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .switch-row {
    display: flex;
    align-items: flex-start;
    cursor: pointer;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 0 4px;
    border-top: 1px solid var(--border);
    margin-top: 8px;
  }

  .option-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .option-label {
    font-size: 13px;
    font-weight: 550;
  }

  .option-hint {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.35;
  }

  .switch-row input[type="checkbox"] {
    appearance: none;
    width: 40px;
    height: 24px;
    border-radius: 999px;
    background: var(--border);
    position: relative;
    cursor: pointer;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .switch-row input[type="checkbox"]::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--bg);
    box-shadow: 0 1px 2px color-mix(in oklab, #000 20%, transparent);
    transition: transform 0.15s ease;
  }

  .switch-row input[type="checkbox"]:checked {
    background: var(--primary);
  }

  .switch-row input[type="checkbox"]:checked::after {
    transform: translateX(16px);
  }

  .btn {
    appearance: none;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--fg);
    font: inherit;
    font-size: 12.5px;
    padding: 7px 11px;
    border-radius: var(--radius);
    corner-shape: var(--corner);
    cursor: pointer;
  }

  .btn:hover {
    border-color: color-mix(in oklab, var(--primary) 40%, var(--border));
    color: var(--primary);
  }

  @media (max-width: 720px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
