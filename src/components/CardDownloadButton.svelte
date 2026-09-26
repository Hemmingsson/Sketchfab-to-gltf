<script lang="ts">
  import { exportFormatWord } from "../lib/settings.js";
  import { isInProgress } from "../shared/format";
  import { app, downloadModel, jobFor } from "../shared/store.svelte";

  let { uid, url }: { uid: string; url: string } = $props();

  const job = $derived(jobFor(uid));
  const phase = $derived(job?.phase ?? "idle");
  const busy = $derived(isInProgress(phase));
  const format = $derived(exportFormatWord(app.settings));

  const tip = $derived.by(() => {
    if (busy) return `Downloading ${Math.round(job?.pct ?? 0)}%`;
    if (phase === "done") return `${format} downloaded`;
    if (phase === "error") return `Retry ${format}`;
    return `Download ${format}`;
  });

  function onClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    downloadModel(url);
  }
</script>

<!-- Light DOM inside Sketchfab's card corner; styles come from page-button-styles.ts.
     Only on cards without Sketchfab's own download link. The icon reuses Sketchfab's
     `.card-model__feature.--downloads` glyph so it matches theirs exactly. -->
<button
  type="button"
  data-sf-dl="card"
  class="help"
  class:sf-dl--progress={busy}
  class:sf-dl--done={phase === "done"}
  class:sf-dl--error={phase === "error"}
  aria-label={tip}
  onclick={onClick}
>
  {#if busy}
    <span class="sf-dl-spinner" aria-hidden="true"></span>
  {:else}
    <span class="card-model__feature --downloads" aria-hidden="true"></span>
  {/if}
  <span class="tooltip tooltip-up">{tip}</span>
</button>
