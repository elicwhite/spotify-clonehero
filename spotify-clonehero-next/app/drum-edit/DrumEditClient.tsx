'use client';

import {defaultIniChartModifiers} from '@eliwhite/scan-chart';
import {
  TrackEditPage,
  DEFAULT_DRUMS_EXPERT_SCOPE,
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

const CONFIG: TrackEditPageConfig = {
  namespace: 'drum-edit',
  route: '/drum-edit',
  defaultScope: DEFAULT_DRUMS_EXPERT_SCOPE,
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
