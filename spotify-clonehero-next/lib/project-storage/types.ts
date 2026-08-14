/**
 * The one logical project model the app lists, opens, renames and deletes
 * through, regardless of which entrypoint created a project or which on-disk
 * shape its directory has.
 *
 * Two on-disk layouts exist and neither is copied into the other: a
 * `chart-package` directory (`lib/project-storage/opfsProjectStore.ts`) and a
 * `drum-transcription` directory (`lib/drum-transcription/storage/opfs.ts`).
 * `projects.ts` normalizes both into a {@link ProjectRecord} and dispatches
 * lifecycle writes back to whichever store owns the layout.
 */

import type {ProjectStage} from '@/lib/drum-transcription/storage/opfs';

/** Which entrypoint a project was started from. */
export type ProjectOrigin =
  | 'chart-editor'
  | 'drum-transcription'
  | 'tempo'
  | 'add-lyrics'
  | 'difficulties';

/** Which on-disk shape a project's directory has. */
export type ProjectLayout = 'chart-package' | 'drum-transcription';

export interface ProjectRecord {
  id: string;
  /** OPFS namespace the directory actually lives in. */
  namespace: string;
  layout: ProjectLayout;
  origin: ProjectOrigin;
  name: string;
  artist: string;
  charter: string;
  createdAt: string;
  updatedAt: string;
  /** Nominal chart length. Null on a drum-transcription project whose audio
   *  has not been decoded yet. */
  durationSeconds: number | null;
  /** False for a project created with no audio and never given any. */
  hasAudio: boolean;
  /**
   * False when the project's directory does not yet hold an openable chart,
   * i.e. a drum-transcription project whose pipeline has not reached
   * `editing`. Opening such a project resumes the pipeline; it does not
   * mount an editor.
   */
  ready: boolean;
  /** The drum-transcription pipeline stage, when this project has one. Null
   *  for `chart-package` projects, which have no pipeline. */
  pipelineStage: ProjectStage | null;
}
