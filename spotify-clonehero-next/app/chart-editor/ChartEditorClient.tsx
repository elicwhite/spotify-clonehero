'use client';

import {
  DEFAULT_GUITAR_EXPERT_SCOPE,
  findPreferredTrack,
  TrackEditPage,
  type TrackEditPageConfig,
} from '@/components/chart-editor';

export const CONFIG: TrackEditPageConfig = {
  namespace: 'chart-editor',
  route: '/chart-editor',
  defaultScope: DEFAULT_GUITAR_EXPERT_SCOPE,
  pageTitle: 'Chart Editor',
  pageDescription:
    'Load a chart, then switch between its guitar, bass, and drum highways.',
  dropZoneId: 'chart-editor-chart',
  findTrack: findPreferredTrack,
  noTrackMessage: 'No guitar, bass, or drum track found in chart.',
  // The instrument/difficulty inventory is the Chart Matrix in the shared
  // sidebar (capabilities default to `'all'`), driven by the same
  // `visibleTrackKeys`/`SET_TRACK_VISIBILITY` state the multi-pane highway
  // and stacked piano roll read.
  stackedPianoRoll: true,
};

export default function ChartEditorClient() {
  return <TrackEditPage {...CONFIG} />;
}
