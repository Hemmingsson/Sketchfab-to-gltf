<script lang="ts">
  import Browser from "./Browser.svelte";
  import ComponentsLab from "./ComponentsLab.svelte";
  import PageDownloadButton from "../src/components/PageDownloadButton.svelte";
  import PageToaster from "../src/components/PageToaster.svelte";
  import PopupShell from "../src/components/PopupShell.svelte";
  import Primitives from "./Primitives.svelte";
  import { enqueueNewModel, failActive } from "./mock-backend";

  const stageUrl = "sketchfab.com/3d-models/2010-citroen-ds-survolt-b00a8be4…";
</script>

<main class="page">
  <div class="layout">
    <section class="stage" aria-label="Sketchfab page mock">
      <Browser address={stageUrl}>
        <div class="viewer" aria-hidden="true"></div>
        <div class="actions">
          <span class="ghost-action">Download 3D Model</span>
          <PageDownloadButton />
          <span class="ghost-action">+ Add to</span>
          <span class="ghost-action">Embed</span>
          <span class="ghost-action">Share</span>
        </div>
        <div class="stage-fill"></div>
      </Browser>
    </section>

    <PopupShell />
  </div>

  <section class="demo-controls">
    <div class="actions-row">
      <button type="button" onclick={enqueueNewModel}>Enqueue download</button>
      <button type="button" class="ghost" onclick={failActive}>Fail active</button>
      <a class="ghost link" href="/tuner.html">Transition tuner →</a>
    </div>
  </section>

  <hr class="divider" />

  <Primitives />
  <ComponentsLab />

  <PageToaster />
</main>

<style>
  .page {
    position: relative;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 24px 16px 48px;
  }

  .divider {
    width: min(100%, var(--demo-max));
    border: 0;
    border-top: 1px solid var(--border);
    margin: 12px 0 4px;
  }

  .layout {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    align-items: stretch;
    justify-content: center;
    width: 100%;
    max-width: var(--demo-max);
  }

  .stage {
    position: relative;
    flex: 1 1 420px;
    min-height: 520px;
    max-width: 520px;
    display: flex;
    flex-direction: column;
  }

  .stage :global(.browser) {
    flex: 1 1 auto;
    min-height: 520px;
  }

  .viewer {
    height: 220px;
    margin: 12px 12px 0;
    border-radius: var(--radius);
    corner-shape: var(--corner);
    background:
      radial-gradient(circle at 40% 45%, color-mix(in oklab, var(--primary) 25%, transparent), transparent 55%),
      linear-gradient(160deg, #2a3038, #12161b);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 16px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }

  .ghost-action {
    display: inline-flex;
    align-items: center;
    height: 33px;
    margin-right: 30px;
    font-family: "Open Sans", var(--font);
    font-size: 14px;
    font-weight: 400;
    color: var(--muted);
  }

  .ghost-action:first-child {
    color: var(--primary);
  }

  /* FA Pro is absent in the playground — approximate tray + check icons. */
  .actions :global(.fa-arrow-down-to-bracket::before),
  .actions :global(.fa-check::before) {
    content: "";
    display: block;
    width: 14px;
    height: 14px;
    background: currentColor;
  }

  .actions :global(.fa-arrow-down-to-bracket::before) {
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='black' d='M8 1.75a.75.75 0 0 1 .75.75v6.19l1.72-1.72a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 1.06-1.06l1.72 1.72V2.5A.75.75 0 0 1 8 1.75Z'/%3E%3Cpath fill='black' d='M2.5 10.25a.75.75 0 0 1 .75.75v1.25c0 .69.56 1.25 1.25 1.25h7c.69 0 1.25-.56 1.25-1.25V11a.75.75 0 0 1 1.5 0v1.25A2.75 2.75 0 0 1 11.5 15h-7A2.75 2.75 0 0 1 1.75 12.25V11a.75.75 0 0 1 .75-.75Z'/%3E%3C/svg%3E")
      center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='black' d='M8 1.75a.75.75 0 0 1 .75.75v6.19l1.72-1.72a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 1.06-1.06l1.72 1.72V2.5A.75.75 0 0 1 8 1.75Z'/%3E%3Cpath fill='black' d='M2.5 10.25a.75.75 0 0 1 .75.75v1.25c0 .69.56 1.25 1.25 1.25h7c.69 0 1.25-.56 1.25-1.25V11a.75.75 0 0 1 1.5 0v1.25A2.75 2.75 0 0 1 11.5 15h-7A2.75 2.75 0 0 1 1.75 12.25V11a.75.75 0 0 1 .75-.75Z'/%3E%3C/svg%3E")
      center / contain no-repeat;
  }

  .actions :global(.fa-check::before) {
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='black' d='M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z'/%3E%3C/svg%3E")
      center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='black' d='M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z'/%3E%3C/svg%3E")
      center / contain no-repeat;
  }

  .stage-fill {
    flex: 1;
  }

  .demo-controls {
    width: min(100%, var(--demo-max));
  }

  .actions-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .actions-row button {
    appearance: none;
    border: 0;
    background: var(--primary);
    color: #fff;
    font: inherit;
    font-size: 12.5px;
    font-weight: 550;
    padding: 8px 12px;
    border-radius: var(--radius);
    corner-shape: var(--corner);
    cursor: pointer;
  }

  .actions-row .link {
    align-self: center;
    margin-left: auto;
    font-size: 12.5px;
    font-weight: 550;
    color: var(--primary);
    text-decoration: none;
  }

  .actions-row button.ghost {
    background: transparent;
    color: var(--fg);
    border: 1px solid var(--border);
  }

  .actions-row button:hover {
    filter: brightness(1.05);
  }
</style>
