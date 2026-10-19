const APPLE_MUSIC_RETURN_PATHS = new Set([
  '/find-music',
  '/find-music/recommendations',
]);

export function safeAppleMusicReturnPath(value: string | null): string {
  return value && APPLE_MUSIC_RETURN_PATHS.has(value) ? value : '/find-music';
}
