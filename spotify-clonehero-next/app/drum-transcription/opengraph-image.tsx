import {createToolOgImage, OG_SIZE} from '@/lib/og/tool-og-image';

export const alt = 'Turn a song into a draft drum chart';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function OpengraphImage() {
  return createToolOgImage('drum-transcription');
}
