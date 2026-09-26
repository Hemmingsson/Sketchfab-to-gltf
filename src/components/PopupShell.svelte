<script lang="ts">
  import { Settings } from "@jis3r/icons";
  import { app, goSettings } from "../shared/store.svelte";
  import DownloadDetail from "./DownloadDetail.svelte";
  import DownloadsList from "./DownloadsList.svelte";
  import SettingsView from "./SettingsView.svelte";

  let { framed = true }: { framed?: boolean } = $props();

  // VT overlay lives under :root — push radius there so flat (real popup) stays square mid-flight.
  $effect(() => {
    const root = document.documentElement.style;
    if (framed) root.removeProperty("--vt-popup-radius");
    else root.setProperty("--vt-popup-radius", "0px");
    return () => root.removeProperty("--vt-popup-radius");
  });
</script>

<div class="popup" class:flat={!framed} data-vt-popup>
  {#if app.route.name === "list"}
    <div class="view">
      <header class="top" data-vt-bar>
        <h1 data-vt-title>Sketchfab to glTF</h1>
        <button type="button" class="icon-chip" aria-label="Settings" onclick={goSettings}>
          <Settings size={16} />
        </button>
      </header>
      <div class="main" data-vt-body>
        <DownloadsList />
      </div>
    </div>
  {:else if app.route.name === "detail"}
    <div class="view">
      <DownloadDetail />
    </div>
  {:else}
    <div class="view">
      <SettingsView />
    </div>
  {/if}
</div>

<style>
  .popup {
    /* Nested group for route transitions; see src/shared/view-transitions.css. */
    view-transition-name: popup;
    position: relative;
    width: min(100%, 380px);
    height: 520px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    corner-shape: var(--corner);
    overflow: hidden;
    box-shadow: var(--shadow-elevated);
  }

  .popup.flat {
    width: 380px;
    max-width: 100%;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .view {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    min-height: 0;
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .top h1 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    width: max-content;
  }

  .main {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
</style>
