<script lang="ts">
  import { ChevronRight } from "@jis3r/icons";
  import { groupProgress } from "../lib/log-groups.js";
  import { formatBytes, formatBytesRange } from "../shared/format";
  import type { LogEntry } from "../shared/types";
  import LogMarker from "./LogMarker.svelte";
  import ProgressBar from "./ProgressBar.svelte";

  /** Parent row (e.g. `textures`) plus its child rows (`parent === entry.group`). */
  let { entry, items }: { entry: LogEntry; items: LogEntry[] } = $props();

  let open = $state(false);

  const progress = $derived(groupProgress(entry, items));
  const pct = $derived(
    progress.total ? Math.round((progress.finished / progress.total) * 100) : 0
  );
  /** Open row title carries the live count: `Textures 3/8`. */
  const liveTitle = $derived(
    entry.total === undefined ? undefined : `${entry.text} ${progress.finished}/${progress.total}`
  );
  const inFlight = $derived(
    progress.inFlight
      .slice(0, 3)
      .map((c) => c.text)
      .join(", ")
  );

  /** `2048x2048` → `2048²`; other sizes keep `W×H`. */
  function shortDims(w: number | undefined, h: number | undefined) {
    return w === h && w !== undefined ? `${w}²` : `${w ?? "?"}×${h ?? "?"}`;
  }

  type Row = {
    id: string;
    name: string;
    dims: string;
    size: string;
    mark: "" | "passthrough" | "warn" | "failed";
    note?: string;
  };

  const rows = $derived(
    items.map((c): Row => {
      const { inBytes, outBytes } = c;
      const finished = inBytes !== undefined && outBytes !== undefined;
      return {
        id: c.id,
        name: c.text,
        dims: finished ? shortDims(c.width, c.height) : "",
        size: finished ? formatBytesRange(inBytes, outBytes) : "",
        mark:
          c.status === "error"
            ? "failed"
            : c.status === "warn"
              ? "warn"
              : c.detail === "passthrough"
                ? "passthrough"
                : "",
        note: c.detail,
      };
    })
  );

  /** Align bar and table with the row text: depth × 14 + icon + gap. */
  const inset = $derived((entry.depth ?? 0) > 0 ? (entry.depth ?? 0) * 14 + 22 : 26);

  const outTotal = $derived(items.reduce((sum, c) => sum + (c.outBytes ?? 0), 0));
  const summary = $derived(
    [entry.detail, outTotal ? formatBytes(outTotal) : ""].filter(Boolean).join(" · ")
  );
</script>

<div class="group" style="--inset: {inset}px">
  {#if entry.active}
    <LogMarker {entry} text={liveTitle} detail={inFlight || entry.detail} />
    <div class="bar">
      <ProgressBar value={pct} />
    </div>
  {:else}
    <LogMarker {entry} detail={summary}>
      {#snippet trailing()}
        {#if items.length}
          <button
            type="button"
            class="disclosure"
            class:open
            aria-expanded={open}
            aria-label={open ? "Hide details" : "Show details"}
            onclick={() => (open = !open)}
          >
            <ChevronRight size={14} />
          </button>
        {/if}
      {/snippet}
    </LogMarker>
    {#if open}
      <div class="table" role="table" aria-label="{entry.text} details">
        {#each rows as row (row.id)}
          <div class="tr" role="row" class:warn={row.mark === "warn" || row.mark === "failed"}>
            <span class="name" role="cell" title={row.note ? `${row.name} — ${row.note}` : row.name}>
              <span class="base">{row.name}</span>
              {#if row.mark}<span class="mark">{row.mark}</span>{/if}
            </span>
            <span class="dims" role="cell">{row.dims}</span>
            <span class="size" role="cell">{row.size}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .bar {
    padding: 0 0 6px var(--inset);
  }

  .disclosure {
    appearance: none;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    margin: -1px 0;
    border: 0;
    border-radius: 6px;
    corner-shape: var(--corner);
    background: none;
    color: var(--muted);
    display: grid;
    place-items: center;
    padding: 0;
    cursor: pointer;
    transition:
      transform 0.15s ease,
      background 0.15s ease;
  }

  .disclosure :global(div[role="img"]) {
    display: grid;
    line-height: 0;
    pointer-events: none;
  }

  .disclosure:hover {
    background: var(--muted-bg);
    color: var(--fg);
  }

  .disclosure:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 1px;
  }

  .disclosure.open {
    transform: rotate(90deg);
  }

  .table {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    column-gap: 8px;
    margin: 0 0 6px var(--inset);
    font-size: 11.5px;
    line-height: 1.5;
    color: color-mix(in oklab, var(--fg) 70%, var(--muted));
    font-variant-numeric: tabular-nums;
  }

  .tr {
    display: contents;
  }

  .name {
    display: flex;
    align-items: baseline;
    gap: 5px;
    min-width: 0;
  }

  .base {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dims,
  .size {
    white-space: nowrap;
    color: var(--muted);
    text-align: right;
  }

  .mark {
    flex-shrink: 0;
    padding: 0 4px;
    border-radius: 4px;
    corner-shape: var(--corner);
    background: var(--muted-bg);
    color: var(--muted);
    font-size: 10px;
    line-height: 15px;
  }

  .tr.warn .mark {
    background: var(--warn-bg);
  }

  .tr.warn > span,
  .tr.warn .mark {
    color: var(--warn-fg);
  }

  @media (prefers-reduced-motion: reduce) {
    .disclosure {
      transition: none;
    }
  }
</style>
