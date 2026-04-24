import * as React from 'react';

const MOBILE_BREAKPOINT = 768;

// Subscribe through matchMedia so React is notified of viewport
// crossings; read innerWidth for the actual boolean so the snapshot
// is tearing-safe (matchMedia and innerWidth can drift by one pixel
// on fractional-DPR displays).
function subscribe(callback: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

// SSR has no viewport; default to desktop so the server-rendered HTML
// matches the most common hydration target and the first client read
// corrects it without a tree mismatch.
function getServerSnapshot() {
  return false;
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
