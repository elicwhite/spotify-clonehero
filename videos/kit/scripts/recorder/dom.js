// Element boxes (`window.__recDom`): where an element is, in CSS px of the
// viewport, the one shape every part of the recorder measures with (the
// harness's component crops and gesture targets, and the app probes).
//
// Injected at document start next to virtual-clock.js, before any app
// probe; nothing runs until something calls it.

(() => {
  'use strict';
  if (window.__recDom) return;

  /** An element's box {x, y, width, height} (CSS px), or null for no element. */
  const box = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {x: r.x, y: r.y, width: r.width, height: r.height};
  };

  const api = {
    box,
    /** The box of the first element `selector` matches, or null. */
    boxOf: selector => box(document.querySelector(selector)),
    /** {name: box} for {name: selector}: each selector's first match, or null. */
    boxes: selectors =>
      Object.fromEntries(
        Object.entries(selectors).map(([name, selector]) => [
          name,
          box(document.querySelector(selector)),
        ]),
      ),
    /** An element's centre {x, y} (CSS px), or null. */
    centre: el => {
      const b = box(el);
      return b ? {x: b.x + b.width / 2, y: b.y + b.height / 2} : null;
    },
  };
  Object.defineProperty(window, '__recDom', {
    value: api,
    configurable: false,
    enumerable: false,
  });
})();
