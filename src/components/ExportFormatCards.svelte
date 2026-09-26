<script module lang="ts">
  import type { ExportFormat } from "../shared/types";

  const formats: { value: ExportFormat; label: string }[] = [
    { value: "glb", label: "GLB — single binary file" },
    { value: "gltf-zip", label: "glTF ZIP — .gltf + .bin + textures" },
  ];
</script>

<script lang="ts">
  import { exportIconKind } from "../lib/settings.js";
  import FileIcon from "./FileIcon.svelte";

  let {
    value,
    onchange,
    name = "exportFormat",
  }: {
    value: ExportFormat;
    onchange: (next: ExportFormat) => void;
    name?: string;
  } = $props();
</script>

<div class="format-grid" role="radiogroup" aria-label="Export format">
  {#each formats as fmt (fmt.value)}
    <label class="format-card">
      <input
        type="radio"
        {name}
        value={fmt.value}
        checked={value === fmt.value}
        aria-label={fmt.label}
        onchange={() => onchange(fmt.value)}
      />
      <FileIcon kind={exportIconKind({ exportFormat: fmt.value })} class="format-icon" />
    </label>
  {/each}
</div>

<style>
  .format-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .format-card {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    corner-shape: var(--corner);
    cursor: pointer;
    background: color-mix(in oklab, var(--muted-bg) 35%, transparent);
    color: var(--fg);
  }

  .format-card:has(input:checked) {
    border-color: color-mix(in oklab, var(--primary) 55%, var(--border));
    background: color-mix(in oklab, var(--primary) 8%, transparent);
  }

  .format-card:has(input:checked) :global(.format-icon) {
    color: var(--primary);
  }

  .format-card:has(input:focus-visible) {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .format-card input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    margin: 0;
    pointer-events: none;
  }

  .format-card :global(.format-icon) {
    width: 44px;
  }
</style>
