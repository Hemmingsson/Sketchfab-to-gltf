import type { Attachment } from "svelte/attachments";

/** Toggle `.fade-top` / `.fade-bottom` on overflow scrollers. */
function readFade(el: HTMLElement) {
  const { scrollTop, scrollHeight, clientHeight } = el;
  return {
    top: scrollTop > 1,
    bottom: scrollTop + clientHeight < scrollHeight - 1,
  };
}

/** `{@attach scrollFade}` on an element that also has `.scroll-fade`. */
export const scrollFade: Attachment<HTMLElement> = (el) => {
  let raf = 0;
  let prevTop = false;
  let prevBottom = false;

  const update = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const next = readFade(el);
      if (next.top !== prevTop) {
        prevTop = next.top;
        el.classList.toggle("fade-top", next.top);
      }
      if (next.bottom !== prevBottom) {
        prevBottom = next.bottom;
        el.classList.toggle("fade-bottom", next.bottom);
      }
    });
  };

  el.addEventListener("scroll", update, { passive: true });
  const ro = new ResizeObserver(update);
  ro.observe(el);
  update();

  return () => {
    cancelAnimationFrame(raf);
    el.removeEventListener("scroll", update);
    ro.disconnect();
  };
};
