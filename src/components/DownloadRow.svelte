<script lang="ts">
  import { RotateCcw } from "@jis3r/icons";
  import { isInProgress, statusLine } from "../shared/format";
  import { goDetail, retryJob } from "../shared/store.svelte";
  import type { DownloadJob } from "../shared/types";
  import ProgressBar from "./ProgressBar.svelte";

  let {
    job,
    /** Lab / detail: no navigation or retry. */
    static: isStatic = false,
  }: {
    job: DownloadJob;
    static?: boolean;
  } = $props();

  const busy = $derived(isInProgress(job.phase));
  const tone = $derived(
    job.phase === "done" ? "done" : job.phase === "error" ? "error" : "default"
  );
</script>

<div class="row" class:static={isStatic}>
  {#if isStatic}
    <div class="main" inert>
      {@render body()}
    </div>
  {:else}
    <button type="button" class="main" onclick={() => goDetail(job.id)}>
      {@render body()}
    </button>
    {#if job.phase === "error"}
      <button
        type="button"
        class="icon-chip accent"
        title="Retry"
        aria-label="Retry"
        onclick={() => retryJob(job.id)}
      >
        <RotateCcw size={15} />
      </button>
    {/if}
  {/if}
</div>

{#snippet body()}
  <span class="media" aria-hidden="true">
    {#if job.thumbUrl}
      <img src={job.thumbUrl} alt="" loading="lazy" />
    {/if}
  </span>

  <span class="content">
    <span class="title">{job.name}</span>
    <span class="desc" class:error={job.phase === "error"} class:busy>
      {statusLine(job)}
    </span>
    {#if busy || job.phase === "done" || job.phase === "error"}
      <span class="progress-wrap">
        <ProgressBar value={job.pct} {tone} />
      </span>
    {/if}
  </span>
{/snippet}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    border-bottom: 1px solid var(--border);
  }

  .row:hover:not(.static) {
    background: color-mix(in oklab, var(--fg) 4%, transparent);
  }

  .main {
    appearance: none;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 10px 10px 14px;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    font: inherit;
  }

  .static .main {
    cursor: default;
  }

  .main:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: -2px;
  }

  .media {
    position: relative;
    width: 40px;
    height: 40px;
    border-radius: var(--radius);
    corner-shape: var(--corner);
    overflow: hidden;
    background: var(--muted-bg);
    flex-shrink: 0;
  }

  .media img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .title {
    font-size: 13px;
    font-weight: 550;
    color: var(--fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .desc {
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .desc.error {
    color: var(--secondary);
  }

  .desc.busy {
    color: var(--primary);
  }

  .progress-wrap {
    margin-top: 6px;
  }

  .row :global(.icon-chip) {
    margin-right: 8px;
    flex-shrink: 0;
  }
</style>
