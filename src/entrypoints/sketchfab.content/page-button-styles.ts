/** Styles for the light-DOM buttons: model page, card corner, collection header. */
export const PAGE_BUTTON_PHASE_CSS = `
button[data-sf-dl="page"].c-model-actions__button {
  /* Keep GLB / glTF caps; Sketchfab's button class uses capitalize. */
  text-transform: none;
}

button[data-sf-dl="page"].sf-dl--progress .button__text-container {
  font-variant-numeric: tabular-nums;
  min-width: 9em;
  display: inline-block;
  text-align: left;
  background: linear-gradient(
    100deg,
    currentColor 0%,
    currentColor 38%,
    color-mix(in srgb, currentColor 35%, #fff) 50%,
    currentColor 62%,
    currentColor 100%
  );
  background-size: 220% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: sf-dl-shimmer 1.6s linear infinite;
}

button[data-sf-dl="page"].sf-dl--done {
  color: #1ac95d;
}

button[data-sf-dl="page"].sf-dl--done .button__text-container {
  font-weight: 600;
}

button[data-sf-dl="page"].sf-dl--error {
  color: #e9256d;
}

button[data-sf-dl="page"].sf-dl--error .button__text-container {
  font-weight: 700;
}

/* Card corner icon: matches Sketchfab's .card-model__feature
   (white 50%, white on hover, 0 1px 2px black 30% shadow).
   Hidden until the card is hovered (or in-progress / error / focus). */
button[data-sf-dl="card"] {
  appearance: none;
  position: relative;
  display: inline-flex;
  align-items: center;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease;
}

.card-model:hover button[data-sf-dl="card"],
.card-model:focus-within button[data-sf-dl="card"],
button[data-sf-dl="card"]:focus-visible,
button[data-sf-dl="card"].sf-dl--progress,
button[data-sf-dl="card"].sf-dl--error {
  opacity: 1;
}

button[data-sf-dl="card"]:hover,
button[data-sf-dl="card"].sf-dl--progress {
  color: #fff;
}

/* Sketchfab's own download glyph: their ::before rule draws it, only the color is ours. */
button[data-sf-dl="card"] .card-model__feature {
  display: block;
  margin: 0;
  color: inherit;
}

button[data-sf-dl="card"] .sf-dl-spinner {
  box-sizing: border-box;
  width: 14px;
  height: 14px;
  margin: 2px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
  animation: sf-dl-spin 0.7s linear infinite;
}

button[data-sf-dl="card"].sf-dl--done {
  color: #1ac95d;
}

button[data-sf-dl="card"].sf-dl--error {
  color: #e9256d;
}

/* Collection header: Sketchfab's .button classes carry the look; only the icon needs sizing. */
button[data-sf-dl="collection"] {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-variant-numeric: tabular-nums;
}

button[data-sf-dl="collection"] svg {
  display: block;
  width: auto;
  height: 16px;
}

button[data-sf-dl="collection"].sf-dl--progress svg {
  animation: sf-dl-pulse 1.2s ease-in-out infinite;
}

button[data-sf-dl="collection"].sf-dl--error {
  color: #e9256d;
}

@keyframes sf-dl-pulse {
  50% { opacity: 0.4; }
}

@keyframes sf-dl-spin {
  to { transform: rotate(360deg); }
}

@keyframes sf-dl-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

@media (prefers-reduced-motion: reduce) {
  button[data-sf-dl="page"].sf-dl--progress .button__text-container {
    animation: none;
    background: none;
    -webkit-text-fill-color: currentColor;
    -webkit-background-clip: unset;
    background-clip: unset;
  }

  button[data-sf-dl="card"] .sf-dl-spinner,
  button[data-sf-dl="collection"].sf-dl--progress svg {
    animation: none;
  }

  button[data-sf-dl="card"] .sf-dl-spinner {
    opacity: 0.7;
  }
}
`.trim();

export function ensurePageButtonStyles(): void {
  if (document.getElementById("sf-dl-btn-styles")) return;
  const style = document.createElement("style");
  style.id = "sf-dl-btn-styles";
  style.textContent = PAGE_BUTTON_PHASE_CSS;
  (document.head ?? document.documentElement).appendChild(style);
}
