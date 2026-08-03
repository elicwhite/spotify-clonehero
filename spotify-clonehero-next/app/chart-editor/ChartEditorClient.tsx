'use client';

import {
  DEFAULT_GUITAR_EXPERT_SCOPE,
  TrackEditPage,
  type TrackEditPageConfig,
} from '@/components/chart-editor';

export const CONFIG: TrackEditPageConfig = {
  namespace: 'chart-editor',
  route: '/chart-editor',
  // `/drum-edit`, `/guitar-edit` and `/bass-edit` redirect here (route model,
  // plan 0074). Their OPFS namespaces are adopted read/write in place so
  // projects saved on those routes stay listed and a `?project=` link that
  // followed the redirect still resolves.
  legacyNamespaces: ['drum-edit', 'guitar-edit', 'bass-edit'],
  defaultScope: DEFAULT_GUITAR_EXPERT_SCOPE,
  pageTitle: 'Chart Editor',
  pageDescription:
    'Load a chart, then switch between its guitar, bass, and drum highways.',
  dropZoneId: 'chart-editor-chart',
  // The instrument/difficulty inventory is the Chart Matrix in the shared
  // sidebar, driven by the same `visibleTrackKeys`/`SET_TRACK_VISIBILITY`
  // state the multi-pane highway and stacked piano roll read. The editor
  // opens with every instrument's highest charted difficulty visible (route
  // model, plan 0074) — that is `TrackEditPage`'s only seeding behavior.
  stackedPianoRoll: true,
};

export default function ChartEditorClient() {
  return <TrackEditPage {...CONFIG} />;
}
