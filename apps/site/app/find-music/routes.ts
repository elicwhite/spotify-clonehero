import type {FindMusicView} from './types';

export const FIND_MUSIC_PATH = '/find-music';
export const FIND_MUSIC_RECOMMENDATIONS_PATH = '/find-music/recommendations';

export function findMusicPathForView(view: FindMusicView) {
  return view === 'radar' ? FIND_MUSIC_RECOMMENDATIONS_PATH : FIND_MUSIC_PATH;
}
