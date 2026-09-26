import { flushSync } from "svelte";

/** Named hooks for popup list ↔ detail; styles live in `view-transitions.css`. */
export type NavType = "detail-open" | "detail-close" | "settings-open" | "settings-close";

const LIST = "[data-vt-list]";
const ROW = "[data-vt-row]";
const HERO = "[data-vt-hero]";
/** Longest the frozen frame waits for thumbnails to decode. */
const IMAGE_WAIT_MS = 100;

/** List scroll offset when a detail opened, so Back lands the hero on its old row. */
let listScrollTop = 0;
let named: HTMLElement[] = [];
let current: ViewTransition | null = null;

type ListLayout = { heroTop: number; push: number };

function clearNames() {
  for (const el of named) {
    el.style.removeProperty("view-transition-name");
    el.style.removeProperty("view-transition-class");
    el.style.removeProperty("view-transition-group");
  }
  named = [];
}

/**
 * Name the list rows visible in the scroller: the hero pairs with the detail
 * header (`job-hero`); the rest split away above/below it. The scroller becomes
 * a containing group (`job-list`) so rows are clipped to its box mid-flight;
 * offscreen rows stay unnamed. Returns the hero's top and how far rows below
 * travel to leave the scroller.
 */
function nameRows(heroId: string): ListLayout | null {
  const list = document.querySelector<HTMLElement>(LIST);
  if (!list) return null;
  const box = list.getBoundingClientRect();
  const rows = [...list.querySelectorAll<HTMLElement>(ROW)];
  const hero = rows.findIndex((el) => el.dataset.vtRow === heroId);
  if (hero === -1) return null;
  list.style.setProperty("view-transition-name", "job-list");
  list.style.setProperty("view-transition-group", "contain");
  named.push(list);
  let firstBelow = Infinity;
  rows.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    if (r.bottom <= box.top || r.top >= box.bottom) return;
    if (i > hero) firstBelow = Math.min(firstBelow, r.top);
    el.style.setProperty("view-transition-name", i === hero ? "job-hero" : `job-row-${i}`);
    // The hero travels between views; keep it out of the clipped list group.
    if (i === hero) el.style.setProperty("view-transition-group", "none");
    if (i !== hero) el.style.setProperty("view-transition-class", i > hero ? "below" : "above");
    named.push(el);
  });
  return {
    heroTop: rows[hero].getBoundingClientRect().top,
    push: Number.isFinite(firstBelow) ? box.bottom - firstBelow : 0,
  };
}

function detailHeroTop(): number | null {
  return document.querySelector(HERO)?.getBoundingClientRect().top ?? null;
}

/**
 * Distances the keyframes travel, set on :root so the pseudo-element tree
 * inherits them: `--vt-dy` is how far the hero rises from its row to the
 * detail header; `--vt-push` sends the rows below it out of the list.
 */
function setDistances(list: ListLayout | null, detailTop: number | null) {
  const root = document.documentElement.style;
  const dy = list && detailTop !== null ? list.heroTop - detailTop : 0;
  root.setProperty("--vt-dy", `${Math.max(0, dy)}px`);
  root.setProperty("--vt-push", `${list?.push ?? 0}px`);
}

/** Let visible thumbnails decode so the new snapshot never pops them in. */
function imagesReady(): Promise<unknown> {
  const imgs = [...document.querySelectorAll<HTMLImageElement>(`${HERO} img, ${ROW} img`)];
  return Promise.race([
    Promise.allSettled(imgs.map((img) => img.decode())),
    new Promise((r) => setTimeout(r, IMAGE_WAIT_MS)),
  ]);
}

/** Transition types need the options form of startViewTransition (Chrome 125+). */
const supportsTypes =
  typeof document !== "undefined" &&
  typeof document.startViewTransition === "function" &&
  CSS.supports("selector(:active-view-transition-type(x))");

/**
 * Run a route change inside a same-document view transition. Falls back to a
 * plain update without the API or under reduced motion.
 */
export function navigate(type: NavType, update: () => void, heroId?: string) {
  if (!supportsTypes || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }

  clearNames();
  let list: ListLayout | null = null;
  let detailTop: number | null = null;
  if (type === "detail-open" && heroId) {
    listScrollTop = document.querySelector(LIST)?.scrollTop ?? 0;
    list = nameRows(heroId);
  } else if (type === "detail-close") {
    detailTop = detailHeroTop();
  }

  const transition = (current = document.startViewTransition({
    types: [type],
    update: async () => {
      flushSync(update);
      if (!heroId) return;
      if (type === "detail-open") {
        detailTop = detailHeroTop();
      } else {
        const scroller = document.querySelector(LIST);
        if (scroller) scroller.scrollTop = listScrollTop;
        list = nameRows(heroId);
      }
      setDistances(list, detailTop);
      await imagesReady();
    },
  }));
  // A newer navigation skips this one and has already named its own rows.
  const done = () => {
    if (current === transition) clearNames();
  };
  transition.finished.then(done, done);
}
