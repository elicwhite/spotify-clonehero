// Globals that preview/audioManager.ts and preview/clickTrack.ts read and
// write on `window`.
declare global {
  interface Window {
    /** Safari's prefixed AudioContext constructor. */
    webkitAudioContext?: typeof AudioContext;
    /** Safari's prefixed OfflineAudioContext constructor. */
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
    /** The live AudioContext, exposed for debugging in the console. */
    ctx?: AudioContext;
  }
}

export {};
