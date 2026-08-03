'use client';

import {defaultIniChartModifiers} from '@eliwhite/scan-chart';
import {
  TrackEditPage,
  DEFAULT_DRUMS_EXPERT_SCOPE,
  DRUM_EDIT_CAPABILITIES,
  type TrackEditPageConfig,
} from '@/components/chart-editor';

/** Drum-edit always parses charts with pro-drums interpretation — the
 *  page edits a drum chart, and pro-drums tom/cymbal modifiers are
 *  meaningful regardless of what an upstream song.ini says. Everything
 *  else falls back to scan-chart's defaults. */
const PRO_DRUMS_MODIFIERS = {
  ...defaultIniChartModifiers,
  pro_drums: true,
} as const;

export const CONFIG: TrackEditPageConfig = {
  namespace: 'drum-edit',
  route: '/drum-edit',
  defaultScope: DEFAULT_DRUMS_EXPERT_SCOPE,
  // Pin the Chart Matrix to Drums: this single-instrument page has no
  // second instrument to add, and difficulty switching happens through the
  // matrix's own cell toggles instead of a separate picker.
  capabilities: {...DRUM_EDIT_CAPABILITIES, showChartMatrix: 'drums'},
  pageTitle: 'Edit Drum Chart',
  pageDescription:
    'Load an existing chart to edit drums on the Clone Hero highway.',
  dropZoneId: 'drum-edit-chart',
  iniChartModifiersOverride: PRO_DRUMS_MODIFIERS,
  findTrack: trackData =>
    trackData.find(t => t.instrument === 'drums' && t.difficulty === 'expert'),
  noTrackMessage: 'No Expert Drums track found in chart.',
};

export default function DrumEditClient() {
  return <TrackEditPage {...CONFIG} />;
}
