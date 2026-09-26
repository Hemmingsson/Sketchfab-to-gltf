<script lang="ts">
  /** Geist-style browser chrome — https://vercel.com/geist/browser (CSS-only, no Tailwind). */
  let {
    address = "",
    children,
    class: className = "",
  }: {
    address?: string;
    children?: import("svelte").Snippet;
    class?: string;
  } = $props();

  function middleTruncate(value: string, max = 42): string {
    if (value.length <= max) return value;
    const keep = Math.max(6, Math.floor((max - 1) / 2));
    return `${value.slice(0, keep)}…${value.slice(-keep)}`;
  }

  const displayAddress = $derived(middleTruncate(address));
</script>

<div class="browser {className}">
  <div class="chrome" aria-hidden="true">
    <div class="dots">
      <span class="dot close"></span>
      <span class="dot minimize"></span>
      <span class="dot zoom"></span>
    </div>

    <div class="controls">
      <svg class="icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M10 3.5 5.5 8 10 12.5"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <svg class="icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M6 3.5 10.5 8 6 12.5"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <svg class="icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M13 8a5 5 0 1 1-1.2-3.3"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
        <path
          d="M13 3.5v3h-3"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>

    <div class="address">
      <span class="url">{displayAddress}</span>
      <svg class="copy" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect
          x="5.5"
          y="5.5"
          width="7"
          height="7"
          rx="1.25"
          stroke="currentColor"
          stroke-width="1.25"
        />
        <path
          d="M3.5 10.5V3.75A1.25 1.25 0 0 1 4.75 2.5H10.5"
          stroke="currentColor"
          stroke-width="1.25"
          stroke-linecap="round"
        />
      </svg>
    </div>
  </div>

  <div class="body">
    {@render children?.()}
  </div>
</div>

<style>
  .browser {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 0;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    corner-shape: var(--corner);
    overflow: hidden;
    box-shadow: var(--shadow-elevated);
  }

  .chrome {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in oklab, var(--muted-bg) 40%, var(--panel));
  }

  .dots {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .dot.close {
    background: #ff5f57;
  }

  .dot.minimize {
    background: #febc2e;
  }

  .dot.zoom {
    background: #28c840;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    color: var(--muted);
  }

  .icon {
    width: 14px;
    height: 14px;
    display: block;
  }

  .address {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 12px;
    border-radius: 999px;
    background: var(--muted-bg);
    color: var(--fg);
  }

  .url {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1;
    color: var(--muted);
  }

  .copy {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    color: var(--muted);
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--panel);
  }
</style>
