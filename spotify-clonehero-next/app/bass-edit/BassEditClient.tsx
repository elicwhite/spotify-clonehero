'use client';

import {
  TrackEditPage,
  DEFAULT_BASS_EXPERT_SCOPE,
  DifficultyPicker,
  type TrackEditPageConfig,
} from '@/components/chart-editor';

const CONFIG: TrackEditPageConfig = {
  namespace: 'bass-edit',
  route: '/bass-edit',
  defaultScope: DEFAULT_BASS_EXPERT_SCOPE,
  pageTitle: 'Edit Bass Chart',
  pageDescription:
    'Load an existing chart to edit bass on the Clone Hero highway.',
  dropZoneId: 'bass-edit-chart',
  findTrack: trackData =>
    trackData.find(t => t.instrument === 'bass' && t.difficulty === 'expert') ??
    trackData.find(t => t.instrument === 'bass'),
  noTrackMessage: 'No Bass track found in chart.',
  headerExtra: <DifficultyPicker />,
};

export default function BassEditClient() {
  return <TrackEditPage {...CONFIG} />;
}
