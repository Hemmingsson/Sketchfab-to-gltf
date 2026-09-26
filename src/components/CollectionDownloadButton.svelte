<script lang="ts">
  import { exportFormatExt, exportIconKind } from "../lib/settings.js";
  import { batchBusyLine, batchFolder, batchProgress } from "../lib/batch.js";
  import FileIcon from "./FileIcon.svelte";
  import { app, downloadCollection } from "../shared/store.svelte";

  let { uid, count }: { uid: string; count: number | null } = $props();

  let status = $state<"idle" | "listing" | "error">("idle");

  const kind = $derived(exportIconKind(app.settings));
  const ext = $derived(exportFormatExt(app.settings));
  /** Latest run of this collection, read from `app.jobs` (survives a page reload). */
  const run = $derived(batchProgress(app.jobs, uid));
  const running = $derived(run?.running ?? false);

  const label = $derived.by(() => {
    if (status === "listing") return "Queuing models…";
    if (status === "error") return "Could not list models, retry";
    if (run?.running) return batchBusyLine(run);
    return `Download all ${count ? `${count} ` : ""}models as ${ext}`;
  });

  const title = $derived(
    run && !run.running ? `Last run: saved ${run.saved} of ${run.total} to Downloads/${batchFolder(run.name)}` : undefined,
  );

  async function onClick() {
    if (status === "listing" || running) return;
    status = "listing";
    try {
      await downloadCollection(uid);
      status = "idle";
    } catch {
      status = "error";
    }
  }
</script>

<!-- Light DOM beside Sketchfab's Embed / Share; Sketchfab's button classes style it. -->
<button
  type="button"
  data-sf-dl="collection"
  class="button btn-primary-inverted btn-medium"
  class:sf-dl--progress={status === "listing" || running}
  class:sf-dl--error={status === "error"}
  {title}
  onclick={onClick}
>
  <FileIcon {kind} />
  {label}
</button>
