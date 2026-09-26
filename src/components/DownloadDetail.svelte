<script module lang="ts">
  import type { LogView } from "../lib/log-view.js";

  const views: { id: LogView; label: string }[] = [
    { id: "summary", label: "Summary" },
    { id: "raw", label: "Raw" },
  ];
</script>

<script lang="ts">
  import { ArrowLeft, RotateCcw, SquareArrowOutUpRight } from "@jis3r/icons";
  import { formatRawLog, isLogRowVisible, LOG_VIEW_KEY, parseLogView } from "../lib/log-view.js";
  import { goList, retryJob, selectedJob } from "../shared/store.svelte";
  import type { LogEntry } from "../shared/types";
  import DownloadRow from "./DownloadRow.svelte";
  import LogGroup from "./LogGroup.svelte";
  import LogMarker from "./LogMarker.svelte";
  import { scrollFade } from "./scrollFade";

  const job = $derived(selectedJob());

  /**
   * Child rows keyed by their parent's group; the stored log stays flat. A
   * parent always precedes its children, so one pass suffices. Children whose
   * parent was trimmed by the log cap stay in the flat list.
   */
  const tree = $derived.by(() => {
    const byParent: Record<string, LogEntry[]> = {};
    const rows: LogEntry[] = [];
    for (const e of job?.log ?? []) {
      const siblings = e.parent ? byParent[e.parent] : undefined;
      if (siblings) siblings.push(e);
      else rows.push(e);
      if (e.group) byParent[e.group] ??= [];
    }
    return { byParent, rows };
  });

  /** Per-viewer UI preference; storage may be unavailable, so fall back to Summary. */
  function loadView(): LogView {
    try {
      return parseLogView(localStorage.getItem(LOG_VIEW_KEY));
    } catch {
      return "summary";
    }
  }

  let view = $state<LogView>(loadView());
  const raw = $derived(view === "raw");
  const visibleRows = $derived(tree.rows.filter((e) => isLogRowVisible(e, view)));
  const rawText = $derived(formatRawLog(job?.log ?? []));

  function setView(next: LogView) {
    view = next;
    try {
      localStorage.setItem(LOG_VIEW_KEY, next);
    } catch {
      /* preference is best-effort */
    }
  }

  let hovered = $state<"open" | "retry" | null>(null);

  /** Follow the live end of the log; unpin if the user scrolls up to read history. */
  function stickToBottom(el: HTMLDivElement) {
    let pinned = true;
    const nearBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight < 64;

    const scrollEnd = () => {
      el.scrollTop = el.scrollHeight;
    };

    const follow = () => {
      if (!pinned) return;
      requestAnimationFrame(scrollEnd);
    };

    const onScroll = () => {
      pinned = nearBottom();
    };

    const observer = new MutationObserver(follow);
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener("scroll", onScroll, { passive: true });

    // Open at the end. Sync so the view-transition snapshot catches it; rAF for layout.
    scrollEnd();
    requestAnimationFrame(scrollEnd);

    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }
</script>

{#if !job}
  <div class="panel missing">
    <p>Download not found.</p>
    <button type="button" class="link" onclick={goList}>Back to list</button>
  </div>
{:else}
  <div class="panel">
    <header class="top" data-vt-bar>
      <button type="button" class="icon-chip" onclick={goList} aria-label="Back">
        <ArrowLeft size={16} />
      </button>
      <span class="spacer"></span>
      <a
        class="icon-chip"
        href={job.url}
        target="_blank"
        rel="noreferrer"
        aria-label="Open on Sketchfab"
        onmouseenter={() => (hovered = "open")}
        onmouseleave={() => (hovered = null)}
      >
        <SquareArrowOutUpRight size={16} animate={hovered === "open"} />
      </a>
      <button
        type="button"
        class="icon-chip"
        aria-label="Retry"
        onclick={() => retryJob(job.id)}
        onmouseenter={() => (hovered = "retry")}
        onmouseleave={() => (hovered = null)}
      >
        <RotateCcw size={16} animate={hovered === "retry"} />
      </button>
    </header>

    <div class="hero" data-vt-hero>
      <DownloadRow {job} static />
    </div>

    <div class="log-wrap">
      <div class="log-head">
        <h3 class="type-label">Log</h3>
        <div class="seg" role="group" aria-label="Log view">
          {#each views as v (v.id)}
            <button
              type="button"
              class="seg-btn"
              aria-pressed={view === v.id}
              onclick={() => setView(v.id)}
            >
              {v.label}
            </button>
          {/each}
        </div>
      </div>
      {#key `${job.id}:${view}`}
        <div class="scroll scroll-fade" {@attach scrollFade} {@attach stickToBottom}>
          {#if raw}
            <pre class="raw-log">{rawText}</pre>
          {:else}
            {#each visibleRows as entry, i (entry.id)}
              {@const items = entry.group ? tree.byParent[entry.group] : undefined}
              <div class="log-row" class:enter={i === visibleRows.length - 1}>
                {#if items?.length || entry.total !== undefined}
                  <LogGroup {entry} items={items ?? []} />
                {:else}
                  <LogMarker {entry} />
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      {/key}
    </div>
  </div>
{/if}

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .missing {
    padding: 32px 16px;
    text-align: center;
    color: var(--muted);
    font-size: 13px;
    justify-content: center;
  }

  .link {
    appearance: none;
    border: 0;
    background: none;
    color: var(--primary);
    cursor: pointer;
    font: inherit;
    margin-top: 8px;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .spacer {
    flex: 1;
    min-width: 0;
  }

  /* Pairs with the clicked list row; see view-transition.ts + view-transitions.css. */
  .hero {
    view-transition-name: job-hero;
  }

  .log-wrap {
    view-transition-name: detail-log;
    /* Opaque snapshot: list rows slide out underneath during the route transition. */
    background: var(--panel);
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    padding: 10px 14px 14px;
  }

  .log-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 0 0 6px;
    flex-shrink: 0;
  }

  .seg {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    border-radius: 7px;
    corner-shape: var(--corner);
    background: var(--muted-bg);
  }

  .seg-btn {
    appearance: none;
    border: 0;
    margin: 0;
    padding: 1px 8px;
    border-radius: 5px;
    corner-shape: var(--corner);
    background: transparent;
    color: var(--muted);
    font-family: var(--font);
    font-size: 11px;
    font-weight: 550;
    line-height: 16px;
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }

  .seg-btn:hover {
    color: var(--fg);
  }

  .seg-btn[aria-pressed="true"] {
    background: var(--panel);
    color: var(--fg);
    box-shadow: 0 1px 2px color-mix(in oklab, #000 12%, transparent);
  }

  .seg-btn:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 1px;
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-bottom: calc(var(--fade) + 18px);
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .scroll::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }

  .raw-log {
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.45;
    color: var(--fg);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    tab-size: 2;
  }

  .log-row.enter {
    animation: log-in 0.18s ease-out;
  }

  @keyframes log-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .log-row.enter {
      animation: none;
    }

    .seg-btn {
      transition: none;
    }
  }
</style>
