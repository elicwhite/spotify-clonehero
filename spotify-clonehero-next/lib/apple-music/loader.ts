import {MUSICKIT_CDN_URL} from './client';

const SCRIPT_SELECTOR = 'script[data-music-kit-sdk="true"]';

let loadState: 'idle' | 'loading' | 'loaded' = 'idle';
let loadPromise: Promise<void> | null = null;

function hasMusicKitGlobal(): boolean {
  return Boolean((window as Window & {MusicKit?: unknown}).MusicKit);
}

function findScript(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
}

/** Loads Apple's hosted SDK once per document and permits a retry on failure. */
export function loadMusicKitScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('MusicKit requires a browser'));
  }
  if (hasMusicKitGlobal()) {
    loadState = 'loaded';
    return Promise.resolve();
  }
  if (loadState === 'loading' && loadPromise) return loadPromise;
  if (loadState === 'loaded') loadState = 'idle';

  const existing = findScript();
  const script = existing ?? document.createElement('script');
  const createdHere = !existing;
  if (createdHere) {
    script.src = MUSICKIT_CDN_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset['musicKitSdk'] = 'true';
    script.dataset['musicKitLoader'] = 'true';
  }

  loadState = 'loading';
  loadPromise = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
    };
    const handleLoad = () => {
      cleanup();
      if (!hasMusicKitGlobal()) {
        loadState = 'idle';
        loadPromise = null;
        reject(new Error('MusicKit did not initialize'));
        return;
      }
      loadState = 'loaded';
      resolve();
    };
    const handleError = () => {
      cleanup();
      loadState = 'idle';
      loadPromise = null;
      if (createdHere && script.dataset['musicKitLoader'] === 'true') {
        script.remove();
      }
      reject(new Error('MusicKit failed to load'));
    };

    script.addEventListener('load', handleLoad, {once: true});
    script.addEventListener('error', handleError, {once: true});
    if (createdHere) document.head.append(script);
  });

  return loadPromise;
}
