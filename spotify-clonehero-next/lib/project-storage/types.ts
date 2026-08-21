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
  | 'drum-difficulties'
  | 'guitar-difficulties';

/**
 * A `ProjectOrigin` as reported to analytics, which has one more case: the
 * chart is open but nothing told the editor which tool it came from.
 *
 * It lives here rather than in `lib/analytics` so the editor's own state can
 * name it without the domain layer importing the analytics layer.
 */
export type ChartOrigin = ProjectOrigin | typeof UNSET_ORIGIN;

/**
 * Reported when nothing published the open chart's origin.
 *
 * It exists so a host that forgets shows up in the data as a hole rather
 * than as extra `chart-editor` traffic. A default of `'chart-editor'` is
 * indistinguishable from the truth, and telling the tools apart is the whole
 * point of this dimension.
 */
export const UNSET_ORIGIN = 'unset';

/**
 * Every {@link ProjectOrigin}, for validating one that arrived as a string.
 *
 * Written as a keyed object rather than an array because
 * `satisfies readonly ProjectOrigin[]` would accept a SUBSET — a seventh
 * origin could be added and silently rejected by `?from=`, with nothing
 * failing. `Record<ProjectOrigin, true>` is total, so the compiler refuses
 * an incomplete list.
 */
const ALL_PROJECT_ORIGINS = {
  'chart-editor': true,
  'drum-transcription': true,
  tempo: true,
  'add-lyrics': true,
  'drum-difficulties': true,
  'guitar-difficulties': true,
} as const satisfies Record<ProjectOrigin, true>;

export const PROJECT_ORIGINS = Object.keys(
  ALL_PROJECT_ORIGINS,
) as readonly ProjectOrigin[];

/**
 * Reads an origin out of a `?from=` search parameter, or null when the
 * parameter is absent or names something that is not a tool.
 *
 * The tools are becoming landing pages that redirect into `/chart-editor`
 * before a project exists. Without this the editor would stamp every one of
 * those charts `chart-editor`, and each landing page would attribute its own
 * work to the editor — the exact signal the origin field exists to carry
 * (plan 0105). An unrecognized value is rejected rather than trusted: this
 * comes from the URL, so anyone can type anything into it.
 */
export function parseProjectOrigin(
  value: string | null | undefined,
): ProjectOrigin | null {
  const origins: readonly string[] = PROJECT_ORIGINS;
  return value != null && origins.includes(value)
    ? (value as ProjectOrigin)
    : null;
}

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
