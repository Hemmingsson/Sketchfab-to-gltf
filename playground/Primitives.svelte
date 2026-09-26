<script lang="ts">
  import { MediaQuery } from "svelte/reactivity";

  const brand = [
    { token: "--primary", role: "links / progress" },
    { token: "--secondary", role: "failed / error" },
    { token: "--success", role: "done" },
    { token: "--warning", role: "warning" },
  ] as const;

  const surfaces = [
    { token: "--bg", kind: "fill" as const },
    { token: "--panel", kind: "fill" as const },
    { token: "--muted-bg", kind: "fill" as const },
    { token: "--border", kind: "ring" as const },
  ];

  const textColors = [
    { token: "--fg", role: "primary text" },
    { token: "--muted", role: "labels / secondary" },
  ] as const;

  const typeRows = [
    {
      id: "label",
      sample: "Uppercase label",
      className: "type-label",
      size: "11px",
      weight: "600",
      line: "1.4",
      tracking: "0.04em",
      note: "section headings",
    },
    {
      id: "body",
      sample: "Body copy — rows and controls",
      className: "sample-body",
      size: "12.5px",
      weight: "400",
      line: "1.4",
      tracking: "normal",
      note: "default UI text",
    },
    {
      id: "title",
      sample: "Model title",
      className: "sample-title",
      size: "14px",
      weight: "550",
      line: "1.3",
      tracking: "normal",
      note: "download names",
    },
  ] as const;

  const TOKEN_KEYS = [
    "--primary",
    "--secondary",
    "--success",
    "--warning",
    "--bg",
    "--panel",
    "--fg",
    "--muted",
    "--muted-bg",
    "--border",
    "--font",
    "--radius",
    "--corner",
  ] as const;

  const dark = new MediaQuery("prefers-color-scheme: dark");
  const live = $derived.by(() => {
    void dark.current;
    if (typeof document === "undefined") return {} as Record<string, string>;
    const styles = getComputedStyle(document.documentElement);
    const next: Record<string, string> = {};
    for (const token of TOKEN_KEYS) {
      next[token] = styles.getPropertyValue(token).trim();
    }
    return next;
  });
</script>

<div class="lab">
  <header class="lab-head">
    <h1>Primitives</h1>
  </header>

  <section class="block">
    <h2>Brand</h2>
    <div class="frame pad swatches">
      {#each brand as item (item.token)}
        <div class="swatch">
          <span class="chip" style:background="var({item.token})"></span>
          <div class="meta">
            <code class="token">{item.token}</code>
            {#if live[item.token]}
              <span class="hex">{live[item.token]}</span>
            {/if}
            <span class="role">{item.role}</span>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <section class="block">
    <h2>Surface</h2>
    <div class="frame pad swatches">
      {#each surfaces as item (item.token)}
        <div class="swatch">
          {#if item.kind === "ring"}
            <span class="chip ring" style:border-color="var({item.token})"></span>
          {:else}
            <span class="chip surface" style:background="var({item.token})"></span>
          {/if}
          <div class="meta">
            <code class="token">{item.token}</code>
            {#if live[item.token]}
              <span class="hex">{live[item.token]}</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </section>

  <section class="block">
    <h2>Text</h2>
    <div class="frame pad swatches">
      {#each textColors as item (item.token)}
        <div class="swatch">
          <span class="chip text-chip" style:background="var({item.token})"></span>
          <div class="meta">
            <code class="token">{item.token}</code>
            {#if live[item.token]}
              <span class="hex">{live[item.token]}</span>
            {/if}
            <span class="role">{item.role}</span>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <section class="block">
    <h2>Type</h2>
    <div class="frame pad">
      <p class="font-line">
        <code class="token">--font</code>
        <span class="hex">{live["--font"] ?? "system-ui, …"}</span>
      </p>
      <table class="type-table">
        <thead>
          <tr>
            <th>Sample</th>
            <th>Size</th>
            <th>Weight</th>
            <th>Line</th>
            <th>Tracking</th>
            <th>Use</th>
          </tr>
        </thead>
        <tbody>
          {#each typeRows as row (row.id)}
            <tr>
              <td>
                <span class={row.className}>{row.sample}</span>
              </td>
              <td><code>{row.size}</code></td>
              <td><code>{row.weight}</code></td>
              <td><code>{row.line}</code></td>
              <td><code>{row.tracking}</code></td>
              <td class="use">{row.note}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <section class="block">
    <h2>Radius</h2>
    <div class="frame pad swatches">
      <div class="swatch">
        <span class="chip radius-chip"></span>
        <div class="meta">
          <code class="token">--radius</code>
          {#if live["--radius"]}
            <span class="hex">{live["--radius"]}</span>
          {/if}
          <span class="role">panels & controls</span>
        </div>
      </div>
      <div class="swatch">
        <span class="chip radius-chip corner-swatch"></span>
        <div class="meta">
          <code class="token">--corner</code>
          {#if live["--corner"]}
            <span class="hex">{live["--corner"]}</span>
          {/if}
          <span class="role">squircle when supported</span>
        </div>
      </div>
    </div>
  </section>
</div>

<style>
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 14px 20px;
  }

  .swatch {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 160px;
  }

  .chip {
    width: 28px;
    height: 28px;
    border-radius: var(--radius);
    corner-shape: var(--corner);
    flex-shrink: 0;
  }

  .chip.surface,
  .chip.text-chip {
    border: 1px solid var(--border);
  }

  .chip.ring {
    background: transparent;
    border: 2px solid var(--border);
  }

  .chip.radius-chip {
    background: color-mix(in oklab, var(--primary) 18%, var(--muted-bg));
    border: 1px solid var(--border);
  }

  .chip.corner-swatch {
    background: var(--primary);
  }

  .meta {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .hex {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--muted);
  }

  .role {
    font-size: 11px;
    color: var(--muted);
  }

  .font-line {
    margin: 0 0 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: baseline;
  }

  .type-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .type-table th,
  .type-table td {
    text-align: left;
    padding: 8px 10px 8px 0;
    border-top: 1px solid var(--border);
    vertical-align: middle;
  }

  .type-table th {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    letter-spacing: 0.02em;
    border-top: 0;
    padding-top: 0;
  }

  .type-table code {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg);
  }

  .type-table .use {
    color: var(--muted);
    font-size: 11px;
  }

  .sample-body {
    font-size: 12.5px;
    line-height: 1.4;
    color: var(--fg);
  }

  .sample-title {
    font-size: 14px;
    font-weight: 550;
    line-height: 1.3;
    color: var(--fg);
  }
</style>
