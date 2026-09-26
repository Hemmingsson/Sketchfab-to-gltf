import { collectionUid, isHexUid, modelUid } from "../../lib/model-url.js";

export function currentUid(): string | null {
  return modelUid(location.href);
}

export function currentCollectionUid(): string | null {
  return collectionUid(location.href);
}

export type ModelCard = { card: Element; corner: Element; uid: string; url: string };

/**
 * Model cards (search, collections, profiles, related) with Sketchfab's top-right icon corner.
 * Skips cards that already carry Sketchfab's own download link; theirs wins.
 */
export function findModelCards(): ModelCard[] {
  const found: ModelCard[] = [];
  for (const card of document.querySelectorAll(".card-model[data-uid]")) {
    const uid = card.getAttribute("data-uid")?.toLowerCase() ?? "";
    const corner = card.querySelector(".card__main__corner.--top-right");
    if (!isHexUid(uid) || !corner) continue;
    if (corner.querySelector("a.card-model__feature.--downloads")) continue;
    const meta = card.querySelector<HTMLMetaElement>('meta[itemprop="url"]')?.content ?? "";
    const url = modelUid(meta) === uid ? meta : `https://sketchfab.com/models/${uid}`;
    found.push({ card, corner, uid, url });
  }
  return found;
}

/** Collection header actions (Subscribe / Embed / Share) and the "N models" count. */
export function findCollectionActions(): { actions: Element; count: number | null } | null {
  const actions = document.querySelector(".collection-actions");
  if (!actions) return null;
  const raw = document.querySelector(".collection-count .count")?.textContent?.trim() ?? "";
  // "1,234" is fine; an abbreviated "1.2k" would misread, so drop the number.
  const count = /^\d[\d,\s]*$/.test(raw) ? Number(raw.replace(/\D/g, "")) : null;
  return { actions, count };
}

/** Visible label for an action control (prefers Sketchfab's text container). */
function controlLabel(el: Element): string {
  const container = el.querySelector?.(".button__text-container");
  const raw = container ? container.textContent : el.textContent;
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find Sketchfab's "+ Add to" control inside the model actions area.
 * Prefer stable Sketchfab hooks (--add-to / data-selenium), then label text.
 */
export function findAddToControl(): Element | null {
  const actions = document.querySelector(".c-model-actions");
  const scoped = actions || document;

  const byClass = scoped.querySelector(
    ".c-model-actions__button.--add-to, button.--add-to",
  );
  if (byClass) return byClass;

  const bySelenium = scoped.querySelector(
    '[data-selenium="open-collection-popup"]',
  );
  if (bySelenium) return bySelenium;

  const roots: Element[] = [];
  if (actions) roots.push(actions);
  if (document.body) roots.push(document.body);

  const seen = new Set<Element>();
  let best: Element | null = null;
  let bestLen = Infinity;

  for (const root of roots) {
    const candidates = root.querySelectorAll(
      "button.c-model-actions__button, .c-model-actions__button, button, a, [role='button']",
    );
    for (const el of candidates) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.getAttribute("data-sf-dl") === "page") continue;
      const text = controlLabel(el);
      if (/^(\+\s*)?add\s*to$/i.test(text)) return el;
      if (/\badd\s*to\b/i.test(text) && text.length < bestLen) {
        best = el;
        bestLen = text.length;
      }
    }
    if (root === actions && best) return best;
  }
  return best;
}
