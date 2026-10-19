// Centralized window.gtag declaration so any caller (lib/analytics/track,
// AuthProvider, future surfaces) shares one global type and there's no
// risk of conflicting `declare global` blocks.
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export {};
