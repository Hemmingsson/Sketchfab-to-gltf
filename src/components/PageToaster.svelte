<script lang="ts">
  import {
    CircleAlert,
    CircleCheck,
    FileText,
    LoaderPinwheel,
  } from "@jis3r/icons";
  import { MediaQuery } from "svelte/reactivity";
  import { Toaster } from "svelte-sonner";

  const dark = new MediaQuery("prefers-color-scheme: dark");
  const theme = $derived(dark.current ? "dark" : "light");
</script>

<div class="sf-toaster">
  <Toaster {theme} position="bottom-right" closeButton>
    {#snippet loadingIcon()}
      <LoaderPinwheel class="toast-icon toast-icon--loading" size={16} animate={true} />
    {/snippet}
    {#snippet successIcon()}
      <CircleCheck class="toast-icon toast-icon--success" size={16} animate={true} />
    {/snippet}
    {#snippet errorIcon()}
      <CircleAlert class="toast-icon toast-icon--error" size={16} animate={true} />
    {/snippet}
    {#snippet infoIcon()}
      <FileText class="toast-icon toast-icon--info" size={16} animate={true} />
    {/snippet}
    {#snippet warningIcon()}
      <CircleAlert class="toast-icon toast-icon--warning" size={16} animate={true} />
    {/snippet}
  </Toaster>
</div>

<style>
  .sf-toaster {
    font-family: var(--font);
  }

  .sf-toaster :global([data-sonner-toaster]) {
    --width: 320px;
    --normal-bg: var(--panel);
    --normal-text: var(--fg);
    --normal-border: var(--border);
    --success-bg: var(--panel);
    --success-border: var(--border);
    --success-text: var(--fg);
    --error-bg: var(--panel);
    --error-border: var(--border);
    --error-text: var(--fg);
    --info-bg: var(--panel);
    --info-border: var(--border);
    --info-text: var(--fg);
    --warning-bg: var(--panel);
    --warning-border: var(--border);
    --warning-text: var(--fg);
  }

  .sf-toaster :global([data-sonner-toast]) {
    background: var(--panel) !important;
    color: var(--fg) !important;
    border: 1px solid var(--border) !important;
  }

  .sf-toaster :global([data-sonner-toast] [data-title]) {
    color: var(--fg) !important;
  }

  /* The live status line changes length on every update; keep it on one line so the toast height stays put. */
  .sf-toaster :global([data-sonner-toast][data-type="loading"] [data-content]) {
    min-width: 0;
  }

  .sf-toaster :global([data-sonner-toast][data-type="loading"] [data-title]) {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sf-toaster :global([data-sonner-toast] [data-description]) {
    color: var(--muted) !important;
  }

  .sf-toaster :global([data-sonner-toast] [data-close-button]) {
    background: var(--panel) !important;
    border-color: var(--border) !important;
    color: var(--muted) !important;
  }

  /* Thumb + spinner on the right; text keeps the left column. */
  .sf-toaster :global([data-sonner-toast].toast-with-thumb) {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .sf-toaster :global([data-sonner-toast].toast-with-thumb [data-icon]) {
    order: 2;
    margin: 0;
    width: auto;
    height: auto;
  }

  .sf-toaster :global([data-sonner-toast].toast-with-thumb [data-content]) {
    order: 1;
    flex: 1;
    min-width: 0;
  }

  .sf-toaster :global(.toast-icon--success) {
    color: var(--success);
  }

  .sf-toaster :global(.toast-icon--error) {
    color: var(--secondary);
  }

  .sf-toaster :global(.toast-icon--warning) {
    color: var(--warning);
  }

  .sf-toaster :global(.toast-icon--info) {
    color: var(--primary);
  }

  .sf-toaster :global(.toast-icon--loading) {
    color: var(--muted);
  }
</style>
