import {createToolOgImage, OG_SIZE} from '@/lib/og/tool-og-image';

export const alt = 'Build a draft tempo map for 4/4 songs';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function OpengraphImage() {
  return createToolOgImage('tempo');
}
