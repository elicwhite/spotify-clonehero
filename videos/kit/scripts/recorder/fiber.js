// Reading a React app's own objects from the page (`window.__recFiber`), for
// app probes that aim input at what the app drew and read back where the app
// thinks it is.
//
// Injected at document start next to virtual-clock.js; nothing runs until a
// probe calls it. Every helper walks React's fiber tree up from a DOM
// element: a component's props, its context providers, and the `useRef`
// objects in its hook list. These are React internals (the `__reactFiber$`
// key, `memoizedProps`, `memoizedState` hook lists), stable across React 18
// and 19 but not a public API; an app probe states what it looks for, so a
// change shows up as a probe returning null.

(() => {
  'use strict';
  if (window.__recFiber) return;

  /** Hooks per component to scan before giving up (a guard against cycles). */
  const HOOK_LIMIT = 600;

  /** The fiber React keeps on a DOM element, or null. */
  const fiberOf = el => {
    if (!el) return null;
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    return key ? el[key] : null;
  };

  /** The fiber and its ancestors, nearest first. */
  function* ancestors(fiber) {
    for (let f = fiber; f; f = f.return) yield f;
  }

  /**
   * The `useRef` objects in one component's hook list ({current} with an
   * object value), in hook order.
   */
  const refsOf = fiber => {
    const refs = [];
    let hook = fiber ? fiber.memoizedState : null;
    let guard = 0;
    while (
      hook &&
      typeof hook === 'object' &&
      'next' in hook &&
      guard++ < HOOK_LIMIT
    ) {
      const ms = hook.memoizedState;
      if (ms && typeof ms === 'object' && 'current' in ms) refs.push(ms);
      hook = hook.next;
    }
    return refs;
  };

  const api = {
    fiberOf,
    ancestors: el => [...ancestors(fiberOf(el))],
    refsOf,
    /** The first context value above `el` (a provider's `value` prop) that `test` accepts. */
    contextValue(el, test) {
      for (const fiber of ancestors(fiberOf(el))) {
        const value = fiber.memoizedProps && fiber.memoizedProps.value;
        if (value && typeof value === 'object' && test(value)) return value;
      }
      return null;
    },
    /** The first ref value (an object `ref.current`) above `el` that `test` accepts. */
    refValue(el, test) {
      for (const fiber of ancestors(fiberOf(el))) {
        for (const ref of refsOf(fiber)) {
          const value = ref.current;
          if (value && typeof value === 'object' && test(value)) return value;
        }
      }
      return null;
    },
    /** The first fiber above `el` holding a ref whose value `test` accepts. */
    fiberWithRef(el, test) {
      for (const fiber of ancestors(fiberOf(el))) {
        for (const ref of refsOf(fiber)) {
          const value = ref.current;
          if (value && typeof value === 'object' && test(value)) return fiber;
        }
      }
      return null;
    },
  };
  Object.defineProperty(window, '__recFiber', {
    value: api,
    configurable: false,
    enumerable: false,
  });
})();
