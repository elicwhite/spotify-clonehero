'use client';

import {
  DEFAULT_GUITAR_EXPERT_SCOPE,
  TrackEditPage,
  TrackScopePicker,
  type TrackEditPageConfig,
} from '@/components/chart-editor';
import {findPreferredHighwayTrack} from '@/components/chart-editor/TrackScopePicker';

const CONFIG: TrackEditPageConfig = {
  namespace: 'chart-editor',
  route: '/chart-editor',
  defaultScope: DEFAULT_GUITAR_EXPERT_SCOPE,
  pageTitle: 'Chart Editor',
  pageDescription:
    'Load a chart, then switch between its guitar, bass, and drum highways.',
  dropZoneId: 'chart-editor-chart',
  findTrack: findPreferredHighwayTrack,
  noTrackMessage: 'No guitar, bass, or drum track found in chart.',
  leftPanelChildren: <TrackScopePicker />,
  stackedPianoRoll: true,
};

export default function ChartEditorClient() {
  return <TrackEditPage {...CONFIG} />;
}
