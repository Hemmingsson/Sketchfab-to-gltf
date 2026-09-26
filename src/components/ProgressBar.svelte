<script lang="ts">
  let {
    value = 0,
    tone = "default",
  }: {
    value?: number;
    tone?: "default" | "done" | "error";
  } = $props();

  const clamped = $derived(Math.max(0, Math.min(100, Math.round(value))));
</script>

<div
  class="progress"
  data-tone={tone}
  role="progressbar"
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={clamped}
>
  <div class="bar" style="width: {clamped}%"></div>
</div>

<style>
  .progress {
    height: 3px;
    width: 100%;
    background: var(--border);
    border-radius: 999px;
    overflow: hidden;
  }

  .bar {
    height: 100%;
    background: var(--primary);
    border-radius: inherit;
    transition: width 0.2s ease;
  }

  .progress[data-tone="done"] .bar {
    background: var(--success);
  }

  .progress[data-tone="error"] .bar {
    background: var(--secondary);
  }
</style>
