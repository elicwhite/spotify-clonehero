'use client';

import {
  TrackEditPage,
  DEFAULT_BASS_EXPERT_SCOPE,
  DRUM_EDIT_CAPABILITIES,
  type TrackEditPageConfig,
} from '@/components/chart-editor';

export const CONFIG: TrackEditPageConfig = {
  namespace: 'bass-edit',
  route: '/bass-edit',
  defaultScope: DEFAULT_BASS_EXPERT_SCOPE,
  // Pin the Chart Matrix to Bass: this single-instrument page has no second
  // instrument to add, and difficulty switching happens through the
  // matrix's own cell toggles instead of a separate picker.
  capabilities: {...DRUM_EDIT_CAPABILITIES, showChartMatrix: 'bass'},
  pageTitle: 'Edit Bass Chart',
  pageDescription:
    'Load an existing chart to edit bass on the Clone Hero highway.',
  dropZoneId: 'bass-edit-chart',
  findTrack: trackData =>
    trackData.find(t => t.instrument === 'bass' && t.difficulty === 'expert') ??
    trackData.find(t => t.instrument === 'bass'),
  noTrackMessage: 'No Bass track found in chart.',
};

export default function BassEditClient() {
  return <TrackEditPage {...CONFIG} />;
}
