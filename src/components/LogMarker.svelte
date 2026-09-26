<script module lang="ts">
  import {
    Archive,
    CircleCheck,
    Download,
    FileDown,
    FileText,
    Images,
    Key,
    Layers,
    ListTodo,
    PackageCheck,
    Search,
    TriangleAlert,
  } from "@jis3r/icons";
  import type { LogKind } from "../shared/types";

  /** One icon per phase; shared by every row. */
  const icons: Partial<Record<LogKind, typeof ListTodo>> = {
    queued: ListTodo,
    reading: Search,
    decrypt: Key,
    download: Download,
    texture: Images,
    pack: PackageCheck,
    convert: Layers,
    zip: Archive,
    save: FileDown,
    done: CircleCheck,
    error: TriangleAlert,
    info: FileText,
  };
</script>

<script lang="ts">
  import { Check } from "@jis3r/icons";
  import type { Snippet } from "svelte";
  import { humanizeLogText, logTone } from "../shared/format";
  import type { LogEntry } from "../shared/types";
  import Spinner from "./Spinner.svelte";

  let {
    entry,
    /** Force row layout (skip stacked done/error) — used in phases gallery. */
    row = false,
    /** Override the primary label (defaults to `entry.text`). */
    text: textOverride,
    /** Override the dim secondary text (defaults to `entry.detail`). */
    detail: detailOverride,
    /** Extra content at the right edge of the row (e.g. a disclosure button). */
    trailing,
  }: {
    entry: LogEntry;
    row?: boolean;
    text?: string;
    detail?: string;
    trailing?: Snippet;
  } = $props();

  const depth = $derived(Math.max(0, entry.depth ?? 0));
  const nested = $derived(depth > 0);
  const stacked = $derived(
    !row && (entry.kind === "done" || entry.kind === "error") && !nested
  );
  /** Nested active → spinner; top-level active → phase icon (animated). */
  const showSpinner = $derived(!!entry.active && nested);
  const iconActive = $derived(!!entry.active && !nested);

  const detail = $derived(detailOverride ?? entry.detail);
  const grouped = $derived(!!entry.group);
  /** Closed grouped rows show a check (or a warning) instead of the phase icon. */
  const closed = $derived(grouped && !entry.active);
  const failed = $derived(closed && (entry.status === "warn" || entry.status === "error"));
  const Icon = $derived(
    nested ? undefined : failed ? TriangleAlert : closed ? Check : icons[entry.kind]
  );
  /** ×count on an open grouped row; parent rows with a `total` show progress instead. */
  const showCount = $derived(
    grouped && !!entry.active && entry.total === undefined && (entry.count ?? 0) > 1
  );

  /** Display-only: stored text keeps raw byte counts. */
  const sourceText = $derived(textOverride ?? entry.text);
  const text = $derived(humanizeLogText(sourceText));
  /** Done / error rows keep their own emphasis. */
  const tone = $derived(
    failed
      ? "warn"
      : entry.kind === "done" || entry.kind === "error"
        ? "normal"
        : logTone(sourceText)
  );
</script>

{#if entry.kind === "separator"}
  <div class="marker separator" role="presentation">
    <span class="sep-line"></span>
    <span class="sep-mid">
      <Layers size={14} />
      <span class="sep-label">{sourceText}</span>
    </span>
    <span class="sep-line"></span>
  </div>
{:else}
  <div
    class="marker"
    class:nested
    class:stacked
    class:icon-active={iconActive}
    class:dim={tone === "dim"}
    class:warn={tone === "warn"}
    class:closed={closed && !failed}
    data-kind={entry.kind}
    data-depth={depth}
    style="--depth: {depth}"
    role={entry.active ? "status" : undefined}
  >
    <span
      class="icon"
      class:check={nested && entry.done}
      class:no-hover={!entry.active}
      aria-hidden="true"
    >
      {#if showSpinner}
        <Spinner size={nested ? 12 : 14} />
      {:else if nested}
        {#if failed}
          <TriangleAlert size={12} />
        {:else if entry.done}
          <Check size={12} animate={true} />
        {:else}
          <span class="dot"></span>
        {/if}
      {:else if Icon}
        <Icon size={stacked ? 22 : 14} animate={iconActive} />
      {/if}
    </span>
    <span class="body">
      <span class="text" class:shimmer={entry.active}>{text}</span>
      {#if detail}
        <span class="detail">{humanizeLogText(detail)}</span>
      {/if}
    </span>
    {#if showCount}
      <span class="count" aria-label="{entry.count} lines">×{entry.count}</span>
    {/if}
    {@render trailing?.()}
  </div>
{/if}

<style>
  .marker {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 5px 0;
    padding-left: calc(var(--depth, 0) * 14px);
    font-size: 12.5px;
    line-height: 1.4;
    color: var(--muted);
  }

  .marker.nested {
    font-size: 12px;
    padding-top: 3px;
    padding-bottom: 3px;
    gap: 8px;
  }

  /* Completed / failed: icon above text, centered */
  .marker.stacked {
    flex-direction: column;
    align-items: center;
    text-align: center;
    width: 100%;
    gap: 8px;
    padding: 14px 0 8px;
  }

  .icon {
    width: 16px;
    height: 16px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    margin-top: 1px;
    color: color-mix(in oklab, var(--fg) 45%, transparent);
  }

  .icon :global(div[role="img"]) {
    display: grid;
    place-items: center;
    line-height: 0;
  }

  .icon.check :global(div[role="img"]),
  .icon.no-hover :global(div[role="img"]) {
    pointer-events: none;
  }

  .marker.nested .icon {
    width: 14px;
    height: 14px;
  }

  .marker.stacked .icon {
    width: 22px;
    height: 22px;
    margin-top: 0;
  }

  .icon.check {
    color: color-mix(in oklab, var(--fg) 45%, transparent);
  }

  .dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: color-mix(in oklab, var(--fg) 35%, transparent);
  }

  .marker[data-kind="done"] .icon {
    color: var(--success);
  }

  .marker[data-kind="error"] .icon,
  .marker[data-kind="error"] .text {
    color: var(--secondary);
  }

  .marker[data-kind="done"] .text {
    color: var(--fg);
    font-weight: 550;
  }

  .marker:not(.nested) .text {
    color: color-mix(in oklab, var(--fg) 78%, var(--muted));
  }

  /* Low-value detail recedes */
  .marker.dim .text,
  .marker.dim:not(.nested) .text {
    color: color-mix(in oklab, var(--muted) 80%, transparent);
  }

  .marker.dim .dot {
    background: color-mix(in oklab, var(--fg) 22%, transparent);
  }

  /* Warnings stand out: amber text on a faint amber row */
  .marker.warn {
    border-radius: 6px;
    corner-shape: var(--corner);
    background: var(--warn-bg);
  }

  .marker.warn .text,
  .marker.warn:not(.nested) .text,
  .marker.warn .icon {
    color: var(--warn-fg);
  }

  .marker.warn .detail {
    color: color-mix(in oklab, var(--warn-fg) 75%, transparent);
  }

  .marker.warn .dot {
    background: var(--warn-fg);
  }

  .marker.stacked .text {
    color: var(--fg);
    font-weight: 550;
  }

  .marker.stacked[data-kind="error"] .text {
    color: var(--secondary);
  }

  /* Loop icon motion while a top-level phase is active */
  .marker.icon-active[data-kind="reading"] .icon :global(svg) {
    animation: search-bounce-loop 1s ease-in-out infinite;
  }

  @keyframes search-bounce-loop {
    0%,
    100% {
      transform: translate(0, 0);
    }
    25% {
      transform: translate(0, -3px);
    }
    50% {
      transform: translate(-2px, 0);
    }
  }

  .body {
    flex: 1;
    min-width: 0;
  }

  .detail {
    margin-left: 6px;
    font-size: 11.5px;
    color: color-mix(in oklab, var(--muted) 85%, transparent);
    font-variant-numeric: tabular-nums;
    word-break: break-word;
  }

  .count {
    flex-shrink: 0;
    margin-left: auto;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--muted-bg);
    color: var(--muted);
    font-size: 11px;
    line-height: 18px;
    font-variant-numeric: tabular-nums;
  }

  .marker.closed .icon {
    color: var(--success);
  }

  .text {
    min-width: 0;
    word-break: break-word;
    font-variant-numeric: tabular-nums;
  }

  .separator {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
    color: var(--muted);
    font-size: 11px;
    letter-spacing: 0.02em;
    width: 100%;
  }

  .sep-line {
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .sep-mid {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    color: color-mix(in oklab, var(--fg) 55%, var(--muted));
  }

  .sep-label {
    flex-shrink: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .marker.icon-active[data-kind="reading"] .icon :global(svg) {
      animation: none;
    }
  }
</style>
