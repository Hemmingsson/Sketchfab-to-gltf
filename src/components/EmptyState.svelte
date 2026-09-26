<script lang="ts">
  import type { Snippet } from "svelte";

  let { icon }: { icon?: Snippet } = $props();
</script>

<div class="empty">
  <div class="header">
    {#if icon}
      <div class="media" aria-hidden="true">
        {@render icon()}
      </div>
    {/if}
    <h2 class="title">No downloads yet</h2>
    <p class="description">Download a model from Sketchfab to see it here.</p>
  </div>
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    width: 100%;
    height: 100%;
    min-height: 0;
    padding: 32px 20px;
    text-align: center;
    box-sizing: border-box;
  }

  .header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    max-width: 16rem;
  }

  .media {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: var(--radius);
    corner-shape: var(--corner);
    background: var(--muted-bg);
    color: var(--muted);
    margin-bottom: 4px;
  }

  .title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--fg);
  }

  .description {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--muted);
    text-wrap: balance;
  }
</style>
