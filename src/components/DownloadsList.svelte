<script lang="ts">
  import { Download } from "@jis3r/icons";
  import { fade } from "svelte/transition";
  import { app } from "../shared/store.svelte";
  import DownloadRow from "./DownloadRow.svelte";
  import EmptyState from "./EmptyState.svelte";
  import { scrollFade } from "./scrollFade";
</script>

{#if app.jobs.length === 0}
  <EmptyState>
    {#snippet icon()}
      <Download size={18} />
    {/snippet}
  </EmptyState>
{:else}
  <div class="scroll scroll-fade" {@attach scrollFade} data-vt-list>
    <div class="list" role="list">
      {#each app.jobs as job (job.id)}
        <!-- Local transition: fades rows added later, not the whole list on remount. -->
        <div class="item" role="listitem" data-vt-row={job.id} in:fade={{ duration: 200 }}>
          <DownloadRow {job} />
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .scroll {
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .list {
    padding-bottom: 8px;
  }
</style>
