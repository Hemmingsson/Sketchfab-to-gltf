import { mount, unmount, type Component } from "svelte";
import { createShadowRootUi, defineContentScript } from "#imports";
import "../../shared/tokens.css";
import CardDownloadButton from "../../components/CardDownloadButton.svelte";
import CollectionDownloadButton from "../../components/CollectionDownloadButton.svelte";
import PageDownloadButton from "../../components/PageDownloadButton.svelte";
import PageToaster from "../../components/PageToaster.svelte";
import { app, setBackend } from "../../shared/store.svelte";
import { chromeBackend, listenForJobs, loadJobs, loadSettings, watchSettings } from "../../shared/chrome-backend";
import { toastForJob } from "../../shared/job-toasts";
import { ensurePageButtonStyles } from "./page-button-styles";
import {
  currentCollectionUid,
  currentUid,
  findAddToControl,
  findCollectionActions,
  findModelCards,
} from "./placement";

export default defineContentScript({
  matches: ["https://sketchfab.com/*", "https://www.sketchfab.com/*"],
  runAt: "document_idle",
  cssInjectionMode: "ui",
  async main(ctx) {
    setBackend(chromeBackend);
    watchSettings();
    await loadSettings().catch(() => {});
    listenForJobs(toastForJob);

    const toaster = await createShadowRootUi(ctx, {
      name: "sf-dl-toaster",
      position: "inline",
      anchor: "body",
      append: "last",
      onMount: (container) => mount(PageToaster, { target: container }),
      onRemove: (instance) => {
        if (instance) void unmount(instance);
      },
    });
    toaster.mount();

    /** `key` is the model or collection uid this button was mounted for. */
    type Placed = { el: Element; instance: ReturnType<typeof mount>; key: string };

    /** Mount off-DOM and hand back the root element, so it can sit directly among Sketchfab's own controls. */
    function mountDetached<P extends Record<string, unknown>>(
      Component: Component<P>,
      props: P,
      selector: string,
      key: string,
    ): Placed | undefined {
      const staging = document.createElement("div");
      const instance = mount(Component, { target: staging, props });
      const el = staging.querySelector(selector);
      if (el) return { el, instance, key };
      void unmount(instance);
    }

    function drop(placed: Placed | undefined): undefined {
      if (!placed) return;
      void unmount(placed.instance);
      placed.el.remove();
    }

    let pageBtn: Placed | undefined;
    let collectionBtn: Placed | undefined;
    const cardBtns = new Map<Element, Placed>();

    /** Model page: before "+ Add to", no wrapper (avoids flex/gap quirks). */
    function placePageButton() {
      const uid = currentUid();
      const addTo = uid ? findAddToControl() : null;
      if (!uid || !addTo?.parentElement) {
        pageBtn = drop(pageBtn);
        return;
      }
      if (pageBtn?.key === uid && pageBtn.el.isConnected && pageBtn.el.nextElementSibling === addTo) return;
      drop(pageBtn);
      pageBtn = mountDetached(PageDownloadButton, {}, 'button[data-sf-dl="page"]', uid);
      if (pageBtn) addTo.parentElement.insertBefore(pageBtn.el, addTo);
    }

    /** Model cards without Sketchfab's own download icon: first icon in the top-right corner. */
    function placeCardButtons() {
      const cards = findModelCards();
      const live = new Map(cards.map((c) => [c.card, c.uid]));
      for (const [card, placed] of cardBtns) {
        if (live.get(card) === placed.key && placed.el.isConnected) continue;
        drop(placed);
        cardBtns.delete(card);
      }
      for (const { card, corner, uid, url } of cards) {
        if (cardBtns.has(card)) continue;
        const placed = mountDetached(CardDownloadButton, { uid, url }, 'button[data-sf-dl="card"]', uid);
        if (!placed) continue;
        corner.prepend(placed.el);
        cardBtns.set(card, placed);
      }
    }

    /** Collection page: first button in the header actions. */
    function placeCollectionButton() {
      const uid = currentCollectionUid();
      const found = uid ? findCollectionActions() : null;
      if (!uid || !found) {
        collectionBtn = drop(collectionBtn);
        return;
      }
      if (collectionBtn?.key === uid && collectionBtn.el.parentElement === found.actions) return;
      drop(collectionBtn);
      const props = { uid, count: found.count };
      collectionBtn = mountDetached(CollectionDownloadButton, props, 'button[data-sf-dl="collection"]', uid);
      if (collectionBtn) found.actions.prepend(collectionBtn.el);
    }

    function place() {
      placePageButton();
      placeCardButtons();
      placeCollectionButton();
    }

    function removeAll() {
      pageBtn = drop(pageBtn);
      collectionBtn = drop(collectionBtn);
      for (const placed of cardBtns.values()) drop(placed);
      cardBtns.clear();
    }

    ensurePageButtonStyles();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(place, 60);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    /** The only reconciler: on load and on every SPA navigation. */
    function syncToPage() {
      const uid = currentUid();
      app.pageUid = uid;
      app.pageUrl = uid ? location.href : "";
      place();
      loadJobs(true).catch(() => {});
    }

    let lastHref = location.href;
    const onNav = () => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      syncToPage();
    };
    syncToPage();
    ctx.onInvalidated(() => {
      clearTimeout(timer);
      observer.disconnect();
      removeAll();
    });
    ctx.addEventListener(window, "popstate", onNav);
    const nav = (window as Window & { navigation?: EventTarget }).navigation;
    if (nav) nav.addEventListener("navigatesuccess", onNav, { signal: ctx.signal });
    else ctx.setInterval(onNav, 400);
  },
});
