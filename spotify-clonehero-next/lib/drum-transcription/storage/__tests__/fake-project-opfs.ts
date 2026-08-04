/**
 * An in-memory stand-in for `lib/drum-transcription/storage/opfs.ts` — the
 * project layer (project metadata + per-project files), not the OPFS
 * filesystem itself (that is `fake-opfs.ts`).
 *
 * Pipeline suites that want to pin what a run persists mock the whole
 * storage module rather than exercising it, so they can read the resulting
 * files straight out of a Map. That mock is the same for every such suite,
 * so it is built once here and registered from a `jest.mock` factory:
 *
 * ```ts
 * jest.mock('../storage/opfs', () =>
 *   jest
 *     .requireActual<typeof import('../storage/__tests__/fake-project-opfs')>(
 *       '../storage/__tests__/fake-project-opfs',
 *     )
 *     .createProjectOpfsMock(),
 * );
 * ```
 */

/** The mock module's shape, for casting the imported module in a suite. */
export interface ProjectOpfsMock {
  /** Every project file written, keyed `${projectId}/${fileName}`. Binary
   *  writes store the value handed in; JSON writes store its serialization. */
  __files: Map<string, unknown>;
  /** Project metadata by id, as `getProject` would return it. */
  __projects: Map<string, Record<string, unknown>>;
  /** Clears both maps. Call in `beforeEach`. */
  __reset: () => void;
  CHART_FILE_BASENAMES: {chart: string; mid: string};
  editedVariant: (baseName: string) => string;
  createProject: jest.Mock;
  listProjects: jest.Mock;
  deleteProject: jest.Mock;
  getProject: jest.Mock;
  updateProject: jest.Mock;
  hasStoredAudio: jest.Mock;
  storeAudioOriginal: jest.Mock;
  loadFullMixPcm: jest.Mock;
  readOriginalAudio: jest.Mock;
  readSongOpus: jest.Mock;
  writeProjectBinary: jest.Mock;
  readProjectBinary: jest.Mock;
  writeProjectJSON: jest.Mock;
  readProjectJSON: jest.Mock;
  writePackageInfo: jest.Mock;
  writeProjectAssets: jest.Mock;
  projectFileExists: jest.Mock;
  findProjectChartFile: jest.Mock;
  hasProjectChartFile: jest.Mock;
  deleteProjectFile: jest.Mock;
}

export interface ProjectOpfsMockOptions {
  /** Sample count of the Float32Array `loadFullMixPcm` returns. Only matters
   *  to a suite that asserts on the decoded audio's length. */
  fullMixPcmSamples?: number;
  /** Bytes `readOriginalAudio` hands back, for suites that run a real
   *  fingerprint/decode chain over them. */
  originalAudioBytes?: Uint8Array;
}

/** Same preference order as `findProjectChartFile`: an autosaved edited
 *  sibling shadows the pipeline's own output. */
const CHART_BASENAMES = [
  'notes.edited.chart',
  'notes.edited.mid',
  'notes.chart',
  'notes.mid',
];

export function createProjectOpfsMock({
  fullMixPcmSamples = 512,
  originalAudioBytes = new Uint8Array([1, 2, 3, 4]),
}: ProjectOpfsMockOptions = {}): ProjectOpfsMock & {__esModule: true} {
  const files = new Map<string, unknown>();
  const projects = new Map<string, Record<string, unknown>>();
  const key = (projectId: string, fileName: string) =>
    `${projectId}/${fileName}`;

  return {
    __esModule: true,
    __files: files,
    __projects: projects,
    __reset: () => {
      files.clear();
      projects.clear();
    },
    CHART_FILE_BASENAMES: {chart: 'notes.chart', mid: 'notes.mid'},
    editedVariant: (baseName: string) => {
      const dot = baseName.lastIndexOf('.');
      return `${baseName.slice(0, dot)}.edited${baseName.slice(dot)}`;
    },
    createProject: jest.fn(async (name: string) => {
      const id = `proj-${projects.size + 1}`;
      const meta = {
        id,
        name,
        createdAt: '',
        updatedAt: '',
        stage: 'uploaded',
        gridSource: 'predicted',
      };
      projects.set(id, meta);
      return meta;
    }),
    listProjects: jest.fn(async () => [...projects.values()]),
    deleteProject: jest.fn(async (id: string) => {
      projects.delete(id);
      for (const fileKey of [...files.keys()]) {
        if (fileKey.startsWith(`${id}/`)) files.delete(fileKey);
      }
    }),
    getProject: jest.fn(async (id: string) => {
      const meta = projects.get(id);
      if (!meta) throw new Error(`no project ${id}`);
      return meta;
    }),
    updateProject: jest.fn(
      async (id: string, patch: Record<string, unknown>) => {
        projects.set(id, {...projects.get(id), ...patch});
      },
    ),
    hasStoredAudio: jest.fn(async () => true),
    storeAudioOriginal: jest.fn(
      async (id: string, bytes: ArrayBuffer, meta: unknown) => {
        files.set(key(id, 'audio/original'), bytes);
        files.set(key(id, 'audio/meta.json'), JSON.stringify(meta));
      },
    ),
    loadFullMixPcm: jest.fn(async () => new Float32Array(fullMixPcmSamples)),
    readOriginalAudio: jest.fn(async () => ({
      data: originalAudioBytes.slice().buffer,
    })),
    readSongOpus: jest.fn(async () => null),
    writeProjectBinary: jest.fn(
      async (id: string, name: string, data: unknown) => {
        files.set(key(id, name), data);
      },
    ),
    readProjectBinary: jest.fn(async (id: string, name: string) => {
      const raw = files.get(key(id, name));
      // `ArrayBuffer.isView` rather than `instanceof Uint8Array`: a jsdom
      // test environment and the Node realm the chart writer runs in don't
      // share a Uint8Array constructor.
      if (ArrayBuffer.isView(raw)) {
        return raw.buffer.slice(
          raw.byteOffset,
          raw.byteOffset + raw.byteLength,
        ) as ArrayBuffer;
      }
      if (raw instanceof ArrayBuffer) return raw;
      throw new Error(`missing ${name}`);
    }),
    writeProjectJSON: jest.fn(
      async (id: string, name: string, data: unknown) => {
        files.set(key(id, name), JSON.stringify(data));
      },
    ),
    readProjectJSON: jest.fn(async (id: string, name: string) => {
      const raw = files.get(key(id, name));
      if (typeof raw !== 'string') throw new Error(`missing ${name}`);
      return JSON.parse(raw);
    }),
    writePackageInfo: jest.fn(async (id: string, info: unknown) => {
      files.set(key(id, 'package.json'), JSON.stringify(info));
    }),
    writeProjectAssets: jest.fn(
      async (id: string, assets: {fileName: string; data: unknown}[]) => {
        for (const asset of assets) {
          files.set(key(id, `assets/${asset.fileName}`), asset.data);
        }
      },
    ),
    projectFileExists: jest.fn(async (id: string, name: string) =>
      files.has(key(id, name)),
    ),
    findProjectChartFile: jest.fn(
      async (id: string) =>
        CHART_BASENAMES.find(n => files.has(key(id, n))) ?? null,
    ),
    hasProjectChartFile: jest.fn(async (id: string) =>
      CHART_BASENAMES.some(n => files.has(key(id, n))),
    ),
    deleteProjectFile: jest.fn(async (id: string, name: string) => {
      files.delete(key(id, name));
    }),
  };
}
