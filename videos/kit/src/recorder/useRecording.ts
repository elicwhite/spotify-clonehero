import {useVideoConfig} from 'remotion';
import {useScene} from '../clock';
import {useLoaded} from '../load';
import {useOptionalTimeline} from '../music';
import {
  loadRecording,
  type RecordingManifest,
  type RecordingRef,
} from './manifest';
import {assertTakeMatchesEdit} from './takeCheck';

/**
 * A take's manifest; null (with the frame held) until it has loaded.
 *
 * A take plays 1:1 on the film's frames, so its fps must be the
 * composition's. In a scene of a film with a music timeline, the take is
 * also checked against the film's edit over the frames the scene shows
 * (`assertTakeMatchesEdit`), so a take made for an older edit fails the
 * render instead of showing the wrong moment. Standalone windows (a take's
 * own preview) and compositions without a timeline are not checked.
 */
export const useRecording = <M extends RecordingManifest = RecordingManifest>(
  ref: RecordingRef,
): M | null => {
  const manifest = useLoaded(
    `recording:${ref.root}/${ref.id}`,
    () => loadRecording<M>(ref),
    `Loading recording ${ref.root}/${ref.id}`,
  );
  const {fps} = useVideoConfig();
  const timeline = useOptionalTimeline();
  const scene = useScene();
  if (!manifest) return null;
  if (manifest.fps !== fps) {
    throw new Error(
      `${ref.id} was recorded at ${manifest.fps} fps and plays frame for frame, but this composition runs at ${fps} fps`,
    );
  }
  if (timeline && !scene.standalone) {
    assertTakeMatchesEdit(
      manifest,
      timeline.timeline.segments,
      {from: scene.from, to: scene.end},
      ref.writtenBy,
    );
  }
  return manifest;
};
