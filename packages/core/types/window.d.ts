// Globals that preview/audioManager.ts reads and writes on `window`.
declare global {
  interface Window {
    /** Safari's prefixed AudioContext constructor. */
    webkitAudioContext?: typeof AudioContext;
    /** The live AudioContext, exposed for debugging in the console. */
    ctx?: AudioContext;
  }
}

export {};
