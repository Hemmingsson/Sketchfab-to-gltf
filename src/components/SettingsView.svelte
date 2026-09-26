<script lang="ts">
  import { ArrowLeft, RotateCcw, Trash } from "@jis3r/icons";
  import { isInProgress } from "../shared/format";
  import {
    app,
    clearHistory,
    goList,
    setSetting,
    undoClearHistory,
  } from "../shared/store.svelte";
  import ExportFormatCards from "./ExportFormatCards.svelte";
  import { scrollFade } from "./scrollFade";
  import TextureSizeCards from "./TextureSizeCards.svelte";

  const downloads = (n: number) => `${n} finished download${n === 1 ? "" : "s"}`;
  const finished = $derived(app.jobs.filter((j) => !isInProgress(j.phase)).length);
  const historyHint = $derived.by(() => {
    if (app.cleared) return `Cleared ${downloads(app.cleared.length)}`;
    return finished ? `Clear ${downloads(finished)}` : "No finished downloads";
  });

  let dumping = $state(false);

  function onClear() {
    if (dumping || finished === 0) return;
    const reduce =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      clearHistory();
      return;
    }
    dumping = true;
    setTimeout(() => {
      clearHistory();
      dumping = false;
    }, 280);
  }
</script>

<div class="panel">
  <header class="head" data-vt-bar>
    <button type="button" class="icon-chip side" onclick={goList} aria-label="Back">
      <ArrowLeft size={16} />
    </button>
    <h2 data-vt-title>Settings</h2>
    <span class="side" aria-hidden="true"></span>
  </header>

  <div class="body scroll-fade" {@attach scrollFade} data-vt-body>
    <div class="row stack">
      <span class="label">Export format</span>
      <ExportFormatCards
        value={app.settings.exportFormat}
        onchange={(next) => setSetting("exportFormat", next)}
      />
    </div>

    <div class="row stack">
      <span class="label">Max Texture Size</span>
      <TextureSizeCards
        value={app.settings.maxTextureEdge}
        onchange={(next) => setSetting("maxTextureEdge", next)}
      />
    </div>

    <label class="row">
      <span class="label">Page notifications</span>
      <input
        type="checkbox"
        role="switch"
        checked={app.settings.pageToasts}
        onchange={(e) => setSetting("pageToasts", e.currentTarget.checked)}
      />
    </label>

    <label class="row">
      <span class="label">Sketchfab camera &amp; lights</span>
      <input
        type="checkbox"
        role="switch"
        checked={app.settings.includeViewerScene}
        onchange={(e) => setSetting("includeViewerScene", e.currentTarget.checked)}
      />
    </label>

    <label class="row">
      <span class="label">Model id in file name</span>
      <input
        type="checkbox"
        role="switch"
        checked={app.settings.uidInFilename}
        onchange={(e) => setSetting("uidInFilename", e.currentTarget.checked)}
      />
    </label>

    <label class="row">
      <span class="label">Ask where to save</span>
      <input
        type="checkbox"
        role="switch"
        checked={app.settings.askWhereToSave}
        onchange={(e) => setSetting("askWhereToSave", e.currentTarget.checked)}
      />
    </label>

    <label class="row">
      <span class="copy">
        <span class="label">Debug ZIP</span>
        <span class="hint">Intermediates instead of the export</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={app.settings.debugZip}
        onchange={(e) => setSetting("debugZip", e.currentTarget.checked)}
      />
    </label>

    <div class="row">
      <span class="copy">
        <span class="label">History</span>
        <span class="hint">{historyHint}</span>
      </span>
      {#if app.cleared}
        <button
          type="button"
          class="danger undo"
          onclick={undoClearHistory}
          aria-label="Undo clear history"
        >
          <RotateCcw size={14} />
          Undo
        </button>
      {:else}
        <button
          type="button"
          class="danger"
          onclick={onClear}
          disabled={finished === 0}
          aria-label="Clear history"
        >
          <span class:trash-dump={dumping} aria-hidden="true">
            <Trash size={14} />
          </span>
          Clear
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .head {
    display: grid;
    grid-template-columns: 28px 1fr 28px;
    align-items: center;
    gap: 8px;
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .head .side {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
  }

  .head h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    justify-self: start;
    width: max-content;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 8px 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .body::-webkit-scrollbar {
    width: 0;
    height: 0;
  }

  .row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 0;
    border-bottom: 1px solid var(--border);
  }

  .row.stack {
    flex-direction: column;
    align-items: stretch;
  }

  .copy {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .label {
    font-size: 13px;
    font-weight: 550;
  }

  .hint {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.4;
  }

  input[type="checkbox"] {
    appearance: none;
    width: 40px;
    height: 24px;
    border-radius: 999px;
    background: var(--secondary);
    position: relative;
    cursor: pointer;
    flex-shrink: 0;
    margin-top: 2px;
    transition: background 0.15s ease;
  }

  input[type="checkbox"]::after {
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

  input[type="checkbox"]:checked {
    background: var(--success);
  }

  input[type="checkbox"]:checked::after {
    transform: translateX(16px);
  }

  input[type="checkbox"]:focus-visible {
    outline: 2px solid var(--success);
    outline-offset: 2px;
  }

  .danger {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    align-self: flex-start;
    border: 1px solid color-mix(in oklab, var(--secondary) 35%, var(--border));
    background: transparent;
    color: var(--secondary);
    font: inherit;
    font-size: 11.5px;
    font-weight: 550;
    padding: 5px 10px;
    border-radius: var(--radius);
    corner-shape: var(--corner);
    cursor: pointer;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .danger:hover:not(:disabled) {
    background: color-mix(in oklab, var(--secondary) 10%, transparent);
  }

  .danger.undo {
    color: var(--primary);
    border-color: color-mix(in oklab, var(--primary) 35%, var(--border));
  }

  .danger.undo:hover {
    background: color-mix(in oklab, var(--primary) 10%, transparent);
  }

  .danger:disabled {
    opacity: 0.45;
    cursor: default;
  }

  @keyframes trash-dump {
    0% {
      transform: rotate(0) translateY(0);
    }
    30% {
      transform: rotate(-12deg) translateY(1px);
    }
    60% {
      transform: rotate(10deg) translateY(2px);
    }
    100% {
      transform: rotate(0) translateY(0);
    }
  }

  .trash-dump {
    display: inline-flex;
    animation: trash-dump 0.28s ease-in-out;
  }

  @media (prefers-reduced-motion: reduce) {
    .trash-dump {
      animation: none;
    }
  }
</style>
