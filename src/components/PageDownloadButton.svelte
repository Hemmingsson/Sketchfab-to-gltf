<script lang="ts">
  import { exportFormatWord } from "../lib/settings.js";
  import { isInProgress } from "../shared/format";
  import { app, downloadModel, jobFor } from "../shared/store.svelte";
  import type { JobPhase } from "../shared/types";

  let {
    previewPhase,
  }: {
    /** Lab-only: override store phase so previews don't mutate the page job. */
    previewPhase?: JobPhase;
  } = $props();

  const previewing = $derived(previewPhase != null);
  const job = $derived(jobFor(app.pageUid));
  const phase = $derived(previewPhase ?? job?.phase ?? "idle");
  const busy = $derived(isInProgress(phase));
  const done = $derived(phase === "done");
  const errored = $derived(phase === "error");
  const pct = $derived(previewing ? 0 : Math.round(job?.pct ?? 0));
  const product = $derived(exportFormatWord(app.settings));

  let hovering = $state(false);

  const label = $derived.by(() => {
    if (busy) return `Downloading ${pct}%`;
    if (done) return hovering ? `Download ${product}` : `${product} downloaded`;
    if (errored) return `Retry ${product}`;
    return `Download ${product}`;
  });

  const showDone = $derived(done && !hovering);
  /** Download arrow: idle / re-download hover. Checkmark: done (non-hover). */
  const showIcon = $derived(!busy && !showDone && !errored);

  function onClick() {
    if (previewing) return;
    downloadModel(app.pageUrl);
  }
</script>

<button
  type="button"
  data-sf-dl="page"
  class="button btn-textified btn-medium c-model-actions__button --download"
  class:sf-dl--progress={busy}
  class:sf-dl--done={showDone}
  class:sf-dl--error={errored}
  title={errored && !previewing ? job?.error : undefined}
  onclick={onClick}
  onmouseenter={() => (hovering = true)}
  onmouseleave={() => (hovering = false)}
>
  <!-- Sketchfab's own FA classes: their page font paints the glyph. -->
  {#if showDone}
    <span class="icon fa-regular fa-check" aria-hidden="true"></span>
  {:else if showIcon}
    <span class="icon fa-regular fa-arrow-down-to-bracket" aria-hidden="true"></span>
  {/if}
  <span class="button__text-container">{label}</span>
</button>

<style>
  /*
    Idle look only. On Sketchfab this comes from their own
    .c-model-actions__button.--download; here it is the playground's stand-in.
    Phase styling lives in page-button-styles.ts, injected into the light DOM.
  */
  :global(button[data-sf-dl="page"].c-model-actions__button) {
    appearance: none;
    display: inline-flex;
    align-items: center;
    height: 33px;
    margin: 0 30px 0 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    color: var(--color-primary-400, #1caad9);
    font-family: "Open Sans", var(--font, system-ui, sans-serif);
    font-size: 14px;
    font-weight: 400;
    line-height: 1;
    white-space: nowrap;
  }

  :global(button[data-sf-dl="page"].c-model-actions__button .icon) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 16px;
    margin-right: 5px;
    color: inherit;
    line-height: 1;
  }
</style>
