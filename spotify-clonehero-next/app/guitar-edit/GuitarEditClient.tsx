'use client';

import {
  TrackEditPage,
  DEFAULT_GUITAR_EXPERT_SCOPE,
  DifficultyPicker,
  type TrackEditPageConfig,
} from '@/components/chart-editor';

const CONFIG: TrackEditPageConfig = {
  namespace: 'guitar-edit',
  route: '/guitar-edit',
  defaultScope: DEFAULT_GUITAR_EXPERT_SCOPE,
  pageTitle: 'Edit Guitar Chart',
  pageDescription:
    'Load an existing chart to edit guitar on the Clone Hero highway.',
  dropZoneId: 'guitar-edit-chart',
  // Guitar has no pro-drums-style modifier that needs forcing on — use
  // scan-chart's defaults.
  findTrack: trackData =>
    trackData.find(t => t.instrument === 'guitar' && t.difficulty === 'expert') ??
    trackData.find(t => t.instrument === 'guitar'),
  noTrackMessage: 'No Guitar track found in chart.',
  headerExtra: <DifficultyPicker />,
};

export default function GuitarEditClient() {
  return <TrackEditPage {...CONFIG} />;
}
