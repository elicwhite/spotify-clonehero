export const FIND_MUSIC_ACTIVATION_KEY = 'find-music-source-activation';

export function hasFindMusicActivation(
  storage: Pick<Storage, 'getItem'>,
): boolean {
  return storage.getItem(FIND_MUSIC_ACTIVATION_KEY) === 'true';
}

export function markFindMusicActivated(
  storage: Pick<Storage, 'setItem'>,
): void {
  storage.setItem(FIND_MUSIC_ACTIVATION_KEY, 'true');
}

export function clearFindMusicActivation(
  storage: Pick<Storage, 'removeItem'>,
): void {
  storage.removeItem(FIND_MUSIC_ACTIVATION_KEY);
}
