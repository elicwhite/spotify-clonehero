'use client';

import {
  MIN_DRILLABLE_FILLS,
  type GrooveProgress,
  type GrooveSort,
} from '@/lib/drum-fills/grooveClusters';
import type {DrumVoice} from '@/lib/drum-fills/detection/types';
import {useLocalStorageState} from './useLocalStorageState';

interface GrooveFilterState {
  sort: GrooveSort;
  progress: GrooveProgress[];
  voices: DrumVoice[];
  minFills: number;
}

const DEFAULT_GROOVE_FILTERS: GrooveFilterState = {
  sort: 'difficulty-asc',
  progress: [],
  voices: [],
  minFills: MIN_DRILLABLE_FILLS,
};

/**
 * Grooves-page filter state, persisted in localStorage (survives reload).
 */
export function useGrooveFilters() {
  const [state, setState] = useLocalStorageState<GrooveFilterState>(
    'drum-fills:groove-filters',
    DEFAULT_GROOVE_FILTERS,
  );

  return {
    sort: state.sort,
    progress: state.progress,
    voices: state.voices,
    minFills: state.minFills,
    setSort: (sort: GrooveSort) => setState(prev => ({...prev, sort})),
    setMinFills: (minFills: number) => setState(prev => ({...prev, minFills})),
    toggleProgress: (p: GrooveProgress) =>
      setState(prev => ({
        ...prev,
        progress: prev.progress.includes(p)
          ? prev.progress.filter(x => x !== p)
          : [...prev.progress, p],
      })),
    toggleVoice: (v: DrumVoice) =>
      setState(prev => ({
        ...prev,
        voices: prev.voices.includes(v)
          ? prev.voices.filter(x => x !== v)
          : [...prev.voices, v],
      })),
  };
}
