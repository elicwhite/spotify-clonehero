'use client';

import {
  parseAsArrayOf,
  parseAsInteger,
  parseAsStringLiteral,
  useQueryStates,
} from 'nuqs';
import {
  MIN_DRILLABLE_FILLS,
  type GrooveProgress,
  type GrooveSort,
} from '@/lib/drum-fills/grooveClusters';
import type {DrumVoice} from '@/lib/drum-fills/detection/types';

const SORTS: GrooveSort[] = [
  'difficulty-asc',
  'difficulty-desc',
  'fills-desc',
  'tempo-asc',
];
const PROGRESS: GrooveProgress[] = ['not-started', 'in-progress', 'mastered'];
const VOICES: DrumVoice[] = ['kick', 'snare', 'hat', 'tom', 'crash'];

/**
 * Grooves-page filter state, persisted in the URL search params (survives
 * reload, like the Library filters). Param names are prefixed `g` so they don't
 * collide with the Library's params in the shared SPA URL. nuqs only serializes
 * non-default values, so a default view keeps a clean URL.
 */
export function useGrooveFilters() {
  const [raw, setRaw] = useQueryStates(
    {
      gsort: parseAsStringLiteral(SORTS).withDefault('difficulty-asc'),
      gprog: parseAsArrayOf(parseAsStringLiteral(PROGRESS)).withDefault([]),
      gvoice: parseAsArrayOf(parseAsStringLiteral(VOICES)).withDefault([]),
      gmin: parseAsInteger.withDefault(MIN_DRILLABLE_FILLS),
    },
    {history: 'replace', clearOnDefault: true},
  );

  return {
    sort: raw.gsort,
    progress: raw.gprog,
    voices: raw.gvoice,
    minFills: raw.gmin,
    setSort: (sort: GrooveSort) => void setRaw({gsort: sort}),
    setMinFills: (minFills: number) => void setRaw({gmin: minFills}),
    toggleProgress: (p: GrooveProgress) =>
      void setRaw(prev => ({
        gprog: prev.gprog.includes(p)
          ? prev.gprog.filter(x => x !== p)
          : [...prev.gprog, p],
      })),
    toggleVoice: (v: DrumVoice) =>
      void setRaw(prev => ({
        gvoice: prev.gvoice.includes(v)
          ? prev.gvoice.filter(x => x !== v)
          : [...prev.gvoice, v],
      })),
  };
}
