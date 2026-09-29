// Tells the UI when positions may have moved: scroll, resize, DOM mutation
// (hot reload replaces nodes) or a size change. Coalesced to one call per frame.
import { isOverlayHost } from './capture.js';

const FALLBACK_POLL_MS = 1000;

export function watchLayout(onChange: () => void): () => void {
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      onChange();
    });
  };

  const mutations = new MutationObserver((records) => {
    // Our host lives in the document too; its own attribute changes aren't layout.
    if (records.every((r) => r.target instanceof Element && isOverlayHost(r.target))) return;
    schedule();
  });
  mutations.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });

  const sizes = new ResizeObserver(schedule);
  sizes.observe(document.documentElement);
  if (document.body) sizes.observe(document.body);

  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule);
  // Transitions and animations move things without a mutation.
  const poll = setInterval(schedule, FALLBACK_POLL_MS);

  return () => {
    cancelAnimationFrame(frame);
    mutations.disconnect();
    sizes.disconnect();
    window.removeEventListener('scroll', schedule, { capture: true });
    window.removeEventListener('resize', schedule);
    clearInterval(poll);
  };
}
