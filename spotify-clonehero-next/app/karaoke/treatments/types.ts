import type {LyricLine} from '@/lib/karaoke/parse-lyrics';

export interface TreatmentProps {
  lines: LyricLine[];
  currentMs: number;
}

export type TreatmentId = 'highlight' | 'bounce' | 'scroll';

export interface TreatmentOption {
  id: TreatmentId;
  label: string;
}

export const TREATMENTS: TreatmentOption[] = [
  {id: 'highlight', label: 'Classic Highlight'},
  {id: 'bounce', label: 'Bouncing Ball'},
  {id: 'scroll', label: 'Scrolling Lyrics'},
];
