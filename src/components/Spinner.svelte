<script lang="ts">
  let { size = 16 }: { size?: number } = $props();
</script>

<span class="spinner" style="--size: {size}px" role="status" aria-label="Loading"></span>

<style>
  .spinner {
    width: var(--size);
    height: var(--size);
    border: 2px solid color-mix(in oklab, var(--fg) 18%, transparent);
    border-top-color: var(--primary);
    border-radius: 50%;
    display: inline-block;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
      border-top-color: var(--primary);
      opacity: 0.7;
    }
  }
</style>
