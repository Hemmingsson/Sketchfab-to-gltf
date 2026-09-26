<script lang="ts">
  import { LoaderPinwheel } from "@jis3r/icons";
</script>

<div class="thumb" aria-hidden="true">
  <span class="photo"></span>
  <span class="spin">
    <LoaderPinwheel size={16} animate={true} />
  </span>
</div>

<style>
  .thumb {
    position: relative;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 6px;
    overflow: hidden;
    flex-shrink: 0;
    background: color-mix(in oklab, var(--fg) 8%, transparent);
  }

  .photo {
    position: absolute;
    inset: 0;
    background: center / cover no-repeat var(--toast-thumb);
    filter: grayscale(calc(1 - var(--toast-pct, 0)));
    transition: filter 180ms ease;
  }

  .spin {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #fff;
    filter: drop-shadow(0 0 1.5px rgb(0 0 0 / 0.55));
  }
</style>
