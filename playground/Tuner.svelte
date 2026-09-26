<script lang="ts">
  import PopupShell from "../src/components/PopupShell.svelte";
  import { tokensCss } from "./transition-tuner";

  let copied = $state(false);

  async function copyTokens() {
    await navigator.clipboard.writeText(tokensCss());
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<main class="page" data-tuner-page>
  <PopupShell framed={false} />

  <aside class="notes">
    <h1>Transition tuner</h1>
    <ol>
      <li>Drag the timeline playhead to scrub the popup transition.</li>
      <li>Select a track to pick which transition: Open, Close or Settings.</li>
      <li>Drag keyframes to retime a phase; open the curve editor to change its easing.</li>
      <li>Click the page or press Esc to let the popup go.</li>
    </ol>
    <div class="actions">
      <button type="button" onclick={copyTokens}>{copied ? "Copied" : "Copy transition CSS"}</button>
      <a href="/">← Playground</a>
    </div>
    <p class="hint">
      Paste over the <code>:root</code> block in <code>src/shared/view-transitions.css</code>.
    </p>
  </aside>
</main>

<style>
  .page {
    min-height: 100vh;
    box-sizing: border-box;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    gap: 28px;
    /* Popup (520px) clears Theatre's timeline docked at the bottom. */
    padding: 12px 16px;
  }

  .notes {
    width: 260px;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--muted);
  }

  h1 {
    margin: 4px 0 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--fg);
  }

  ol {
    margin: 0 0 14px;
    padding-left: 18px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  button {
    appearance: none;
    border: 0;
    background: var(--primary);
    color: #fff;
    font: inherit;
    font-weight: 550;
    padding: 8px 12px;
    border-radius: var(--radius);
    cursor: pointer;
  }

  a {
    color: var(--primary);
    font-weight: 550;
    text-decoration: none;
  }

  .hint {
    margin: 10px 0 0;
    font-size: 11.5px;
  }

  code {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg);
  }
</style>
