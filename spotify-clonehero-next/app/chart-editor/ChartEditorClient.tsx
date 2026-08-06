'use client';

import {
  DEFAULT_GUITAR_EXPERT_SCOPE,
  TrackEditPage,
  type TrackEditPageConfig,
} from '@/components/chart-editor';
import dynamic from 'next/dynamic';
import OrtRuntimeScript from '@/components/onnx/OrtRuntimeScript';

/**
 * The drum-transcription editor host, loaded only when a project with that
 * layout is actually opened. `TrackEditPage` takes it as a prop so it never
 * imports the transcription feature itself; loading it lazily here is what
 * keeps that feature's modules out of the chart editor's own bundle.
 */
const EditorApp = dynamic(
  () => import('@/app/drum-transcription/components/EditorApp'),
  {ssr: false},
);

export const CONFIG: TrackEditPageConfig = {
  route: '/chart-editor',
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
  // A project whose directory uses the drum-transcription layout is opened
  // by that feature's own editor host, in place, with no copy.
  renderTranscriptionEditor: projectId => (
    <EditorApp projectId={projectId} showRegenerate />
  ),
};

export default function ChartEditorClient() {
  return (
    <>
      {/* Chart Assist can start a drum-transcription run from this route, and
       *  that run gates on `globalThis.ort`. Without this the run waits on a
       *  runtime nothing on the page ever loads. */}
      <OrtRuntimeScript />
      <TrackEditPage {...CONFIG} />
    </>
  );
}
