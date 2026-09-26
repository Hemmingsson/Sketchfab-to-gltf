<script lang="ts">
  import { TEXTURE_SIZE_OPTIONS } from "../lib/settings.js";
  import type { TextureSize } from "../shared/types";

  let {
    value,
    onchange,
    name = "maxTextureEdge",
  }: {
    value: TextureSize;
    onchange: (next: TextureSize) => void;
    name?: string;
  } = $props();

  function toggle(next: TextureSize) {
    onchange(value === next ? 0 : next);
  }
</script>

<div class="options" role="group" aria-label="Max texture size">
  {#each TEXTURE_SIZE_OPTIONS as sz (sz.value)}
    <label class="option">
      <input
        type="checkbox"
        {name}
        value={sz.value}
        checked={value === sz.value}
        onchange={() => toggle(sz.value)}
      />
      <span class="copy">
        <span class="label">{sz.label}</span>
        <span class="hint">{sz.hint}</span>
      </span>
    </label>
  {/each}
</div>

<style>
  .options {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    corner-shape: var(--corner);
    cursor: pointer;
    background: color-mix(in oklab, var(--muted-bg) 35%, transparent);
    color: var(--fg);
  }

  .option:has(input:checked) {
    border-color: color-mix(in oklab, var(--primary) 55%, var(--border));
    background: color-mix(in oklab, var(--primary) 8%, transparent);
  }

  .option:has(input:focus-visible) {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .option input {
    appearance: none;
    width: 16px;
    height: 16px;
    margin: 0;
    border-radius: 4px;
    border: 1.5px solid var(--muted);
    flex-shrink: 0;
    display: grid;
    place-content: center;
    background: var(--panel);
    cursor: pointer;
  }

  .option input::after {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--primary);
    transform: scale(0);
    transition: transform 0.12s ease;
  }

  .option input:checked {
    border-color: var(--primary);
  }

  .option input:checked::after {
    transform: scale(1);
  }

  .copy {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  }

  .label {
    font-size: 13px;
    font-weight: 550;
  }

  .hint {
    font-size: 12px;
    color: var(--muted);
    font-weight: 450;
  }
</style>
