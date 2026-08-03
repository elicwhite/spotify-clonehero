'use client';

import {
  TrackEditPage,
  DEFAULT_GUITAR_EXPERT_SCOPE,
  DRUM_EDIT_CAPABILITIES,
  type TrackEditPageConfig,
} from '@/components/chart-editor';

export const CONFIG: TrackEditPageConfig = {
  namespace: 'guitar-edit',
  route: '/guitar-edit',
  defaultScope: DEFAULT_GUITAR_EXPERT_SCOPE,
  // Pin the Chart Matrix to Guitar: this single-instrument page has no
  // second instrument to add, and difficulty switching happens through the
  // matrix's own cell toggles instead of a separate picker.
  capabilities: {...DRUM_EDIT_CAPABILITIES, showChartMatrix: 'guitar'},
  pageTitle: 'Edit Guitar Chart',
  pageDescription:
    'Load an existing chart to edit guitar on the Clone Hero highway.',
  dropZoneId: 'guitar-edit-chart',
  // Guitar has no pro-drums-style modifier that needs forcing on — use
  // scan-chart's defaults.
  findTrack: trackData =>
    trackData.find(
      t => t.instrument === 'guitar' && t.difficulty === 'expert',
    ) ?? trackData.find(t => t.instrument === 'guitar'),
  noTrackMessage: 'No Guitar track found in chart.',
};

export default function GuitarEditClient() {
  return <TrackEditPage {...CONFIG} />;
}
