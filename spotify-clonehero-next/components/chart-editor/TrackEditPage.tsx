'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {useSearchParams, useRouter} from 'next/navigation';
import {Loader2, AlertCircle, ArrowLeft, FilePlus} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import ChartDropZone from '@/components/chart-picker/ChartDropZone';
import {OrDivider} from '@/components/chart-picker/DropZoneShell';
import type {LoadedFiles} from '@/components/chart-picker/chart-file-readers';
import {findAudioFiles} from '@/lib/preview/chorus-chart-processing';
import {
  chartDocToFolderFiles,
  getAudioAnchor,
  readChartForEditing,
  setAudioAnchor,
} from '@/lib/chart-edit';
import {
  documentIdentityFields,
  getAssistProvenance,
  highestDifficultyTrackKeys,
  withAssistProvenance,
  withSongIniFields,
  type SongMetadataValue,
} from '@/lib/chart-editor-core';
import {AssistRunnerProvider} from '@/components/assist/AssistRunnerProvider';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import {ChartEditorProvider, useChartEditorContext} from './ChartEditorContext';
import {AudioServiceProvider} from './AudioServiceContext';
import {trackKeyId, type EditorScope} from './scope';
import ChartEditor from './ChartEditor';
import type {AudioSource} from './ExportDialog';
import {chartDocToChartText, useChartPackageEditor} from './chartPackage';
import {useEditorKeyboard} from './hooks/useEditorKeyboard';
import {useAutoSave} from './hooks/useAutoSave';
import {anchorPadSamples, usePaddedAudio} from './hooks/usePaddedAudio';
import {
  decodeChartPackageAudio,
  padPackageAudio,
  PACKAGE_AUDIO_META,
  type DecodedPackageAudio,
} from './hooks/projectAudio';
import {useSeparatedStems} from './hooks/useSeparatedStems';
import {
  createOpfsProjectStore,
  type ProjectMetadata,
} from '@/lib/project-storage/opfsProjectStore';
import {
  chartPackageStore,
  createBlankProject,
  deleteProject as deleteProjectRecord,
  findProject,
  listProjects as listProjectRecords,
  renameProject,
} from '@/lib/project-storage/projects';
import type {ProjectRecord} from '@/lib/project-storage/types';
import {attachAudioToProject} from '@/lib/project-storage/attachAudio';
import {
  BLANK_CHART_ARTIST,
  BLANK_CHART_NAME,
  DEFAULT_BLANK_SONG_LENGTH_MS,
} from '@/lib/project-storage/blankChart';
import ProjectList from '@/components/project-list/ProjectList';
import AudioDropZone, {
  type DroppedAudio,
} from '@/components/project-list/AudioDropZone';

/**
 * Message shown for a chart with nothing this editor can open: no guitar,
 * bass or drum track at any difficulty.
 */
export const NO_SUPPORTED_TRACK_MESSAGE =
  'No guitar, bass, or drum track found in chart.';

/**
 * Configuration for an OPFS-project-backed chart-edit page (`/chart-editor`).
 * The OPFS namespace, default scope and labels are captured here;
 * `TrackEditPage` implements the shared shell (load screen, OPFS project
 * list, chart loading/parsing, `ChartEditor` mount) once.
 *
 * Two things are deliberately not configurable, because getting either wrong
 * is silent: which tracks the editor opens with (every instrument's highest
 * charted difficulty, route model plan 0074), and how a chart is parsed for
 * editing (`readChartForEditing`, so cymbal edits round-trip).
 */
export interface TrackEditPageConfig {
  /** This page's route path. */
  route: string;
  /** Scope the editor starts in (instrument/difficulty pair to edit). */
  defaultScope: EditorScope;
  pageTitle: string;
  pageDescription: string;
  dropZoneId: string;
  /** Extra control rendered in the ChartEditor header (e.g. a difficulty picker). */
  headerExtra?: ReactNode;
  /** Extra controls rendered in the ChartEditor left sidebar. */
  leftPanelChildren?: ReactNode;
  /** Use the shared multi-track piano roll for this editor route. */
  stackedPianoRoll?: boolean;
  /**
   * Editor host for a project whose directory uses the drum-transcription
   * layout. Supplied by the route rather than imported here, so opening a
   * chart package never pulls the transcription pipeline into the bundle.
   * Omitted, such a project reports that this page cannot open it.
   */
  renderTranscriptionEditor?: ((projectId: string) => ReactNode) | undefined;
}

// ---------------------------------------------------------------------------
// Page entry point
// ---------------------------------------------------------------------------

export default function TrackEditPage(config: TrackEditPageConfig) {
  return (
    <AudioServiceProvider>
      {/* One assist runner for the whole page: the Chart Assist cards that
       *  run a task here (Tempo map, Lyrics) share it, so only one
       *  assist run is ever in flight and leaving the page aborts it. */}
      <AssistRunnerProvider>
        <ChartEditorProvider activeScope={config.defaultScope}>
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-screen">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            }>
            <TrackEditInner config={config} />
          </Suspense>
        </ChartEditorProvider>
      </AssistRunnerProvider>
    </AudioServiceProvider>
  );
}

// ---------------------------------------------------------------------------
// Inner component (reads search params, manages page state)
// ---------------------------------------------------------------------------

type PageState = 'load' | 'loading-chart' | 'edit';

function TrackEditInner({config}: {config: TrackEditPageConfig}) {
  const {route, pageTitle, pageDescription, dropZoneId} = config;

  const store = useMemo(() => chartPackageStore(), []);

  const searchParams = useSearchParams();
  const router = useRouter();
  const projectId = searchParams.get('project');

  const [pageState, setPageState] = useState<PageState>(
    projectId ? 'loading-chart' : 'load',
  );

  // Every project in every namespace, for the load screen.
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  // projectsLoaded starts false and stays true once we've completed a
  // listProjects() call. loadingProjects is derived from it so the
  // effect below doesn't need to flip a loading flag synchronously.
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const loadingProjects = pageState === 'load' && !projectsLoaded;

  // The outcome of resolving the URL's project, tagged with the id it was
  // resolved for. Tagging is what makes "still resolving" derivable rather
  // than a second flag the effect has to set synchronously.
  const [resolved, setResolved] = useState<{
    projectId: string;
    record: ProjectRecord | null;
    error: string | null;
  } | null>(null);
  const resolvedForUrl = resolved?.projectId === projectId ? resolved : null;
  const openRecord = resolvedForUrl?.record ?? null;
  const resolveError = resolvedForUrl?.error ?? null;

  // Load project list when showing the load screen. All state writes
  // happen in the promise callback, so the effect body itself does no
  // synchronous setState.
  useEffect(() => {
    if (pageState !== 'load') return;

    let cancelled = false;
    listProjectRecords()
      .then(list => {
        if (!cancelled) {
          setProjects(list);
          setProjectsLoaded(true);
        }
      })
      .catch(err => {
        console.warn('Failed to load projects:', err);
        if (!cancelled) setProjectsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [pageState]);

  // Resolve the URL's project to a record, and decide who opens it. A
  // project whose pipeline has not produced a chart yet is not openable
  // here: `/drum-transcription` owns the pipeline UI and the only resume
  // path, so it is handed back there. Every state write happens in a promise
  // callback, so the effect body itself does no synchronous setState.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    findProject(projectId)
      .then(record => {
        if (cancelled) return;
        if (!record) {
          setResolved({
            projectId,
            record: null,
            error: `Project "${projectId}" was not found.`,
          });
          return;
        }
        if (!record.ready) {
          setResolved({projectId, record: null, error: null});
          router.replace(`/drum-transcription?project=${record.id}`);
          return;
        }
        setResolved({projectId, record, error: null});
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to resolve project:', err);
        setResolved({
          projectId,
          record: null,
          error: 'Could not open that project.',
        });
      });
    return () => {
      cancelled = true;
    };
    // `router` is deliberately not a dependency: its identity is not
    // guaranteed stable, and this must resolve once per project id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Handle chart loaded from drop zone (new project)
  const handleChartLoaded = useCallback(
    async (loaded: LoadedFiles) => {
      setPageState('loading-chart');

      try {
        const {files, sourceFormat, originalName, sngMetadata} = loaded;

        const chartDoc = readChartForEditing(files);
        const name =
          chartDoc.parsedChart.metadata.name ?? originalName ?? 'Unknown';
        const artist = chartDoc.parsedChart.metadata.artist ?? 'Unknown';
        const charter = chartDoc.parsedChart.metadata.charter ?? 'Unknown';

        if (
          highestDifficultyTrackKeys(chartDoc.parsedChart.trackData).length ===
          0
        ) {
          throw new Error(NO_SUPPORTED_TRACK_MESSAGE);
        }

        // Find audio files
        const audioFiles = findAudioFiles(files);
        if (audioFiles.length === 0) {
          throw new Error('No audio files found in chart package');
        }

        // Estimate duration from audio (decode one file to get duration)
        const audioCtx = new AudioContext({sampleRate: 44100});
        let durationSeconds = 180; // fallback
        try {
          const firstAudio = audioFiles[0];
          const buffer = firstAudio.data.slice(0).buffer;
          const decoded = await audioCtx.decodeAudioData(buffer as ArrayBuffer);
          durationSeconds = decoded.duration;
        } catch {
          console.warn('Could not decode audio for duration estimation');
        } finally {
          await audioCtx.close();
        }

        // Force .chart output format (input may have been .mid)
        chartDoc.parsedChart.format = 'chart';
        const chartText = chartDocToChartText(chartDoc);

        // Create OPFS project
        const meta = await store.createProject({
          name,
          artist,
          charter,
          durationSeconds,
          sourceFormat,
          originalName,
          sngMetadata,
          chartText,
          audioFiles,
          allFiles: files,
        });

        // Navigate to the project URL
        router.push(`${route}?project=${meta.id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load chart';
        toast.error(msg);
        console.error('Failed to load chart:', err);
        setPageState('load');
      }
    },
    [router, store, route],
  );

  // Handle opening an existing project. A project still mid-pipeline goes to
  // the route that owns the pipeline instead.
  const handleOpenProject = useCallback(
    (record: ProjectRecord) => {
      setPageState('loading-chart');
      router.push(
        record.ready
          ? `${route}?project=${record.id}`
          : `/drum-transcription?project=${record.id}`,
      );
    },
    [router, route],
  );

  const handleDeleteProject = useCallback(async (record: ProjectRecord) => {
    try {
      await deleteProjectRecord(record.id);
      setProjects(prev => prev.filter(p => p.id !== record.id));
      toast.success(`Deleted "${record.name}"`);
    } catch (err) {
      toast.error('Failed to delete project');
      console.error(err);
    }
  }, []);

  const handleRenameProject = useCallback(
    async (record: ProjectRecord, identity: SongMetadataValue) => {
      try {
        const updated = await renameProject(record.id, identity);
        setProjects(prev => prev.map(p => (p.id === record.id ? updated : p)));
      } catch (err) {
        toast.error('Failed to rename project');
        console.error(err);
      }
    },
    [],
  );

  /**
   * Start a chart from a song: a blank chart with the audio already attached,
   * named after the file. The song name is a better guess than the
   * placeholder and the user can correct it in song details; nothing else is
   * inferred from the audio, since aligning notes to a song is the editor's
   * job, not the landing page's.
   */
  const handleCreateChartFromAudio = useCallback(
    async ({fileName, data, durationSeconds}: DroppedAudio) => {
      setPageState('loading-chart');
      try {
        const record = await createBlankProject({
          name: fileName.replace(/\.[^.]+$/, '') || BLANK_CHART_NAME,
          artist: BLANK_CHART_ARTIST,
          songLengthMs: Math.round(durationSeconds * 1000),
        });
        await attachAudioToProject({
          store,
          projectId: record.id,
          files: [{fileName, data}],
          durationSeconds,
        });
        router.push(`${route}?project=${record.id}`);
      } catch (err) {
        toast.error('Failed to create the chart');
        console.error(err);
        setPageState('load');
      }
    },
    [route, router, store],
  );

  // Starting a chart asks nothing up front: it opens on placeholder identity
  // the song-details dialog can replace whenever the user gets to it.
  const handleCreateBlankChart = useCallback(async () => {
    setPageState('loading-chart');
    try {
      const record = await createBlankProject({
        name: BLANK_CHART_NAME,
        artist: BLANK_CHART_ARTIST,
      });
      router.push(`${route}?project=${record.id}`);
    } catch (err) {
      toast.error('Failed to create the chart');
      console.error(err);
      setPageState('load');
    }
  }, [route, router]);

  // Handle going back to load screen
  const handleBack = useCallback(() => {
    setPageState('load');
    router.push(route);
  }, [router, route]);

  // A project in the URL: resolve it, then mount whichever host its layout
  // calls for.
  if (projectId) {
    if (resolveError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-4">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <p className="text-sm text-destructive">{resolveError}</p>
          <Button variant="outline" size="sm" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to projects
          </Button>
        </div>
      );
    }
    if (!openRecord) {
      return (
        <div className="flex items-center justify-center h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      );
    }
    if (openRecord.layout === 'drum-transcription') {
      const host = config.renderTranscriptionEditor?.(openRecord.id);
      if (host) return <>{host}</>;
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-4">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <p className="text-sm text-destructive">
            This page cannot open a drum transcription project.
          </p>
        </div>
      );
    }
    return (
      <TrackEditEditor
        config={config}
        store={store}
        projectId={openRecord.id}
        hasAudio={openRecord.hasAudio}
        onBack={handleBack}
        onReady={() => setPageState('edit')}
      />
    );
  }

  // Load screen
  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <header className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">{pageTitle}</h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            {pageDescription}
          </p>
        </header>

        {/* Two ways in, given the same shape and the same weight: open a
         *  chart somebody already wrote, or start one of your own. */}
        <div className="mb-8 grid gap-4 md:grid-cols-2">
          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle>Load a Chart</CardTitle>
              <CardDescription>Open a chart you already have.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <ChartDropZone
                onLoaded={handleChartLoaded}
                id={dropZoneId}
                disabled={pageState === 'loading-chart'}
              />
            </CardContent>
          </Card>

          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle>Create a Chart</CardTitle>
              <CardDescription>
                Start from a song, or from an empty chart.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 space-y-3">
              <AudioDropZone
                onDropped={handleCreateChartFromAudio}
                disabled={pageState === 'loading-chart'}
              />
              <OrDivider />
              <Button
                variant="outline"
                className="w-full"
                disabled={pageState === 'loading-chart'}
                onClick={handleCreateBlankChart}>
                <FilePlus className="h-4 w-4 mr-2" />
                Start from scratch
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Every project in every namespace */}
        {(projects.length > 0 || loadingProjects) && (
          <Card>
            <CardHeader>
              <CardTitle>Recent Projects</CardTitle>
              <CardDescription>
                Previously opened charts saved in your browser.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProjectList
                records={projects}
                pageOrigin="chart-editor"
                loading={loadingProjects}
                onOpen={handleOpenProject}
                onRename={handleRenameProject}
                onDelete={handleDeleteProject}
              />
            </CardContent>
          </Card>
        )}

        {/* Loading indicator when chart is being processed */}
        {pageState === 'loading-chart' && (
          <div className="flex items-center justify-center gap-3 py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-muted-foreground">Loading chart...</span>
          </div>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Editor component — loads project data from OPFS and renders ChartEditor
// ---------------------------------------------------------------------------

interface TrackEditEditorProps {
  config: TrackEditPageConfig;
  store: ReturnType<typeof createOpfsProjectStore>;
  projectId: string;
  /** Whether this project's `audio/` directory holds anything. False skips
   *  the audio load entirely and plays the chart against the click alone. */
  hasAudio: boolean;
  onBack: () => void;
  onReady: () => void;
}

type LoadingState = 'loading' | 'ready' | 'error';

function TrackEditEditor({
  config,
  store,
  projectId,
  hasAudio: initialHasAudio,
  onBack,
  onReady,
}: TrackEditEditorProps) {
  const {headerExtra, leftPanelChildren, stackedPianoRoll} = config;
  const {state, dispatch} = useChartEditorContext();
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [loadingStep, setLoadingStep] = useState('Loading project...');
  const [errorMessage, setErrorMessage] = useState('');
  const [projectMeta, setProjectMeta] = useState<ProjectMetadata | null>(null);
  // ORIGINAL (unpadded) PCM for the project's own audio files, retained
  // across the session: `usePaddedAudio` re-pads from these on every
  // `audioAnchor` change rather than compounding padding onto an
  // already-padded buffer, and the export path below pads from them too.
  const [packageAudio, setPackageAudio] = useState<DecodedPackageAudio | null>(
    null,
  );
  // Whether the project has audio right now. Starts from the record and
  // flips the moment a dropped file is attached, without a reload.
  const [hasAudio, setHasAudio] = useState(initialHasAudio);
  // Auto-save: write edited chart to OPFS
  const saveFn = useCallback(async () => {
    if (!state.chartDoc) return;
    const {chart, ini} = chartDocToFolderFiles(state.chartDoc);
    if (chart.fileName !== 'notes.chart') {
      throw new Error('writeChartFolder did not produce notes.chart');
    }
    // The ini goes first. A torn save then leaves a newer ini beside an older
    // chart, and the merge on load lets the chart win on everything it can
    // express, so the visible result is one autosave's worth of stale chart
    // content — the same exposure the chart write alone already has. The
    // reverse order would show stale metadata over fresh content, which reads
    // to the user as a lost edit.
    await store.writeSongIni(projectId, ini.data);
    await store.writeEditedChart(
      projectId,
      new TextDecoder().decode(chart.data),
    );
    // Mirror the doc's audio anchor into project metadata: a `.chart` file
    // has nowhere to carry it, and without it a reload would show a chart
    // shifted by the leading silence against unpadded audio. Cheap and
    // idempotent — runs on every autosave.
    await store.updateProject(projectId, {
      audioAnchor: getAudioAnchor(state.chartDoc) ?? null,
      // Assist provenance can't ride the chart file either, so it is mirrored
      // the same way — a reload keeps any staleness prompt, "Keep as-is"
      // dismissal, or chosen drum intensity's provenance the user left.
      assistProvenance: getAssistProvenance(state.chartDoc) ?? null,
      // The record's identity is a display denormalization for the projects
      // list; the document is the truth. Refreshing it here keeps a rename
      // made anywhere else from being the only writer that has to remember.
      ...documentIdentityFields(state.chartDoc),
    });
  }, [projectId, state.chartDoc, store]);

  const {save} = useAutoSave(loadingState === 'ready' ? saveFn : null);

  // Keyboard shortcuts (shared editor defaults, no page-specific additions)
  useEditorKeyboard(save);

  // Load project data from OPFS
  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      try {
        // 1. Load metadata
        setLoadingStep('Loading project metadata...');
        const meta = await store.getProject(projectId);
        if (cancelled) return;
        setProjectMeta(meta);

        // 2. Load chart text (prefer edited, fallback to original)
        setLoadingStep('Loading chart data...');
        const chartText = await store.readChartText(projectId);
        if (cancelled) return;
        const songIni = await store.readSongIni(projectId);
        if (cancelled) return;

        // 3. Build the editable ChartDocument. This is the editor's parse:
        // a basic four-lane drum chart is read as pro-drums so the cymbal
        // toggle the editor offers survives the save it writes. The package's
        // `song.ini` is overlaid onto the result, since the persisted `.chart`
        // has nowhere to carry the fields that live only there (every
        // `diff_*`, `icon`, custom keys).
        const chartBytes = new TextEncoder().encode(chartText);
        let chartDoc = readChartForEditing([
          {fileName: 'notes.chart', data: chartBytes},
        ]);
        if (songIni) {
          chartDoc = withSongIniFields(chartDoc, {
            fileName: 'song.ini',
            data: songIni,
          });
        }
        // 3a. Re-attach the persisted audio anchor (0064 addendum §1)
        // before this doc is ever dispatched, so the padding the chart was
        // saved with is the padding playback and export rebuild from.
        if (meta.audioAnchor) {
          chartDoc = setAudioAnchor(chartDoc, meta.audioAnchor);
        }
        if (meta.assistProvenance) {
          chartDoc = withAssistProvenance(chartDoc, meta.assistProvenance);
        }
        const parsed = chartDoc.parsedChart;

        // 4. Resolve the tracks to open: every instrument's highest charted
        // difficulty (route model, plan 0074). The scope to focus is drums
        // when it's among them, else the first one — a chart with none of
        // them has nothing this editor can open.
        const seededKeys = highestDifficultyTrackKeys(parsed.trackData);
        const scopeTrack =
          seededKeys.find(k => k.instrument === 'drums') ?? seededKeys[0];
        if (!scopeTrack) {
          throw new Error(
            `${NO_SUPPORTED_TRACK_MESSAGE} Available tracks: ` +
              parsed.trackData
                .map(t => `${t.instrument}/${t.difficulty}`)
                .join(', '),
          );
        }
        const currentScope = state.activeScope;
        if (
          currentScope.kind !== 'track' ||
          currentScope.track.instrument !== scopeTrack.instrument ||
          currentScope.track.difficulty !== scopeTrack.difficulty
        ) {
          dispatch({
            type: 'SET_ACTIVE_SCOPE',
            scope: {
              kind: 'track',
              track: {
                instrument: scopeTrack.instrument,
                difficulty: scopeTrack.difficulty,
              },
            },
          });
        }

        // 5. Load audio files from OPFS. A chart created with no audio has
        // none to load; `usePaddedAudio` builds a click-only manager
        // spanning the chart's own `song_length` instead.
        if (meta.hasAudio ?? true) {
          setLoadingStep('Loading audio...');
          const audioFiles = await store.loadAudioFiles(projectId);
          if (cancelled) return;

          if (audioFiles.length === 0) {
            throw new Error('No audio files found in project storage');
          }

          // 6. Decode the package's audio into ORIGINAL (unpadded) PCM.
          // `usePaddedAudio` builds the AudioManager from it (full mix +
          // stems + the synthesized click, chart delay applied) once the
          // chart doc below lands, and rebuilds it whenever the chart's
          // `audioAnchor` or the stem list changes.
          setLoadingStep('Preparing audio playback...');
          const decodedAudio = await decodeChartPackageAudio(audioFiles);
          if (cancelled) return;
          setPackageAudio(decodedAudio);
        }
        setHasAudio(meta.hasAudio ?? true);

        // 7. Update editor state. ChartDoc carries the parsed chart;
        // consumers derive the active track via selectActiveTrack().
        dispatch({type: 'SET_CHART_DOC', chartDoc});
        // The editor starts with every instrument's highest charted
        // difficulty visible. Other tracks remain available in the sidebar
        // without duplicating the piano roll.
        dispatch({
          type: 'SET_VISIBLE_TRACKS',
          tracks: new Set(seededKeys.map(trackKeyId)),
        });
        setLoadingState('ready');
        onReady();
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof Error ? err.message : 'Failed to load project';
        console.error('TrackEditEditor load error:', err);
        setErrorMessage(msg);
        setLoadingState('error');
        toast.error(msg);
      }
    }

    loadProject();

    return () => {
      cancelled = true;
      setPackageAudio(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Build metadata for CloneHeroRenderer
  const cloneHeroMetadata = useMemo(
    () =>
      projectMeta
        ? ({
            name: projectMeta.name,
            artist: projectMeta.artist,
            charter: projectMeta.charter,
            md5: '',
            hasVideoBackground: false,
            albumArtMd5: '',
            notesData: {} as any,
            modifiedTime: projectMeta.updatedAt,
            file: '',
          } as ChartResponseEncore)
        : null,
    [projectMeta],
  );

  // The project's own audio files, raw: what Chart Assist's audio tasks
  // fingerprint and work from, and what an unpadded export ships verbatim.
  const loadAudioFiles = useCallback(
    () => store.loadAudioFiles(projectId),
    [projectId, store],
  );
  // The stem-cache key stored for THIS project. `projectMeta` lags one
  // render behind a client-side project switch, and another project's key
  // says nothing about this one's audio - it would resolve the previous
  // song's separated stems.
  const storedStemFingerprint =
    projectMeta?.id === projectId ? projectMeta.stemFingerprint : undefined;

  // Playback and the waveform come from `usePaddedAudio` below; what this
  // host wants from the chart-package boundary is the chart text, the raw
  // export sources, and the assist audio loader.
  const chartPackage = useChartPackageEditor({
    chartDoc: state.chartDoc ?? null,
    loadAudioFiles,
    stemFingerprint: storedStemFingerprint,
  });

  // Persist a fingerprint the stem probe had to compute, so every later load
  // of this project reads the stem cache directly instead of mixing the
  // package down and hashing it again.
  const handleFingerprintResolved = useCallback(
    (stemFingerprint: string) => {
      setProjectMeta(prev => (prev ? {...prev, stemFingerprint} : prev));
      void store
        .updateProject(projectId, {stemFingerprint})
        .catch(err => console.warn('Could not persist stem fingerprint:', err));
    },
    [projectId, store],
  );

  const separatedStems = useSeparatedStems({
    projectId,
    packageAudio,
    loadAssistAudio: chartPackage.chartAssist.loadAudio,
    storedFingerprint: storedStemFingerprint,
    onFingerprintResolved: handleFingerprintResolved,
  });

  // Everything the live AudioManager plays: the package's own files, plus
  // whatever an assist run separated out of them.
  const stems = useMemo(
    () => [...(packageAudio?.stems ?? []), ...separatedStems],
    [packageAudio, separatedStems],
  );
  const onSongEnded = useCallback(
    () => dispatch({type: 'SET_PLAYING', isPlaying: false}),
    [dispatch],
  );
  // With no audio, the chart's own `song.ini` length is what the transport,
  // the click track and the beat grid span.
  const songLengthMs = state.chartDoc?.parsedChart.metadata.song_length;
  const silentDurationSeconds = hasAudio
    ? undefined
    : songLengthMs && songLengthMs > 0
      ? songLengthMs / 1000
      : DEFAULT_BLANK_SONG_LENGTH_MS / 1000;
  const {
    audioManager,
    fullMixPcm: paddedFullMixPcm,
    stems: paddedStems,
    durationSeconds: audioDurationSeconds,
    rebuilding: audioRebuilding,
  } = usePaddedAudio({
    chartDoc: state.chartDoc,
    audioMeta: packageAudio ? PACKAGE_AUDIO_META : null,
    fullMixPcm: packageAudio?.fullMixPcm ?? null,
    // A package with no `song` file promotes one of its own (guitar, bass)
    // into the full-mix slot; the mixer row has to carry that file's name,
    // not a "song" row playing guitar.
    fullMixName: packageAudio?.fullMixName ?? 'song',
    stems,
    silentDurationSeconds,
    onSongEnded,
  });

  /**
   * Export audio. With no leading silence applied the package's own files
   * ship verbatim (`chartPackage.getAudioSources`). With an `audioAnchor`
   * set, every note in the chart has moved by that much, so the exported
   * audio has to move with it: each of the package's files is padded from
   * the decoded PCM playback already uses and re-encoded. Only the
   * package's own audio is exported — a separated stem is a mixing aid, not
   * part of the chart. The stored audio at rest is never modified.
   */
  const rawAudioSources = chartPackage.getAudioSources;
  const getAudioSources = useCallback(async (): Promise<AudioSource[]> => {
    const anchor = state.chartDoc ? getAudioAnchor(state.chartDoc) : null;
    const padSamples = anchorPadSamples(anchor, PACKAGE_AUDIO_META.sampleRate);
    if (padSamples <= 0 || !packageAudio) return rawAudioSources();
    return padPackageAudio(packageAudio, padSamples);
  }, [state.chartDoc, packageAudio, rawAudioSources]);

  /**
   * Chart Assist wiring for this host, on top of the chart-package defaults:
   * the sample rate of the decoded audio (the leading-silence pad quantizes
   * to it) and a busy reason while the padded AudioManager rebuilds. No
   * leading-silence disabled reason is declared — this editor pads playback
   * through `usePaddedAudio` and pads its exported audio to match, so the
   * action is honest here.
   */
  const chartAssist = useMemo(
    () =>
      hasAudio
        ? {
            ...chartPackage.chartAssist,
            audioSampleRate: PACKAGE_AUDIO_META.sampleRate,
            audioBusyReason: audioRebuilding ? 'Rebuilding audio' : undefined,
          }
        : // With no audio there is nothing for the audio-backed cards to run
          // on, so they are withheld rather than offered and failed. Every
          // card in the section needs audio, so the section is simply absent
          // until a file is attached.
          {},
    [chartPackage.chartAssist, audioRebuilding, hasAudio],
  );

  // The song-details dialog has already written its edit into the chart doc,
  // which the autosave above persists. The identity fields are also the
  // project record's own, and the header, the projects list and the export
  // file name all read them from there, so they are mirrored across.
  const handleMetadataChange = useCallback(
    async ({name, artist, charter}: SongMetadataValue) => {
      const updated = await store.updateProject(projectId, {
        name,
        artist,
        charter,
      });
      setProjectMeta(updated);
    },
    [projectId, store],
  );

  /**
   * A file dropped on the Stems section. The bytes are persisted into the
   * project's `audio/` directory, then the whole audio load is re-run from
   * disk: that is what decides which file is the full mix and what every
   * stem is called, so re-running it is what keeps the live mixer and the
   * stored project describing the same thing.
   *
   * A chart that had no audio also gains a real length: `song_length` is
   * rewritten from the decoded audio so the beat grid, the transport and the
   * exported ini stop reporting the blank chart's placeholder. Note ticks are
   * untouched — attaching audio does not move a note, and nothing here tries
   * to align an existing chart to a song it was not written against.
   */
  const handleAddStem = useCallback(
    async (input: {file: {fileName: string; data: Uint8Array}}) => {
      try {
        await attachAudioToProject({
          store,
          projectId,
          files: [input.file],
        });
        const audioFiles = await store.loadAudioFiles(projectId);
        const decoded = await decodeChartPackageAudio(audioFiles);
        const durationSeconds =
          decoded.fullMixPcm.length /
          PACKAGE_AUDIO_META.channels /
          PACKAGE_AUDIO_META.sampleRate;
        await store.updateProject(projectId, {durationSeconds});
        setProjectMeta(prev => (prev ? {...prev, durationSeconds} : prev));
        setPackageAudio(decoded);
        if (!hasAudio && state.chartDoc) {
          dispatch({
            type: 'SET_CHART_METADATA',
            chartDoc: {
              ...state.chartDoc,
              parsedChart: {
                ...state.chartDoc.parsedChart,
                metadata: {
                  ...state.chartDoc.parsedChart.metadata,
                  song_length: Math.round(durationSeconds * 1000),
                },
              },
            },
          });
        }
        setHasAudio(true);
      } catch (err) {
        console.error('Failed to attach audio:', err);
        toast.error('Could not add that audio file to the project');
      }
    },
    [dispatch, hasAudio, projectId, state.chartDoc, store],
  );

  // Loading state
  if (loadingState === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{loadingStep}</p>
      </div>
    );
  }

  // Error state
  if (loadingState === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <p className="text-sm text-destructive">{errorMessage}</p>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to load screen
        </Button>
      </div>
    );
  }

  const chart = state.chartDoc?.parsedChart ?? null;
  if (!chart || !audioManager || !cloneHeroMetadata) {
    return null;
  }

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col">
      <ChartEditor
        metadata={cloneHeroMetadata}
        chart={chart}
        audioManager={audioManager}
        audioData={paddedFullMixPcm ?? undefined}
        audioChannels={PACKAGE_AUDIO_META.channels}
        durationSeconds={
          audioDurationSeconds || (projectMeta?.durationSeconds ?? 0)
        }
        sections={chart.sections}
        // The document is the identity's source of truth; the record is a
        // display denormalization of it, and is only fallen back to for a
        // chart that carries no name of its own. Seeding from the record
        // unconditionally would let opening the song-details dialog write a
        // stale record name back over the chart and its ini.
        songName={chart.metadata.name || projectMeta?.name || 'Untitled'}
        artistName={chart.metadata.artist || projectMeta?.artist}
        charterName={chart.metadata.charter || projectMeta?.charter}
        onMetadataChange={handleMetadataChange}
        getChartText={chartPackage.getChartText}
        getAudioSources={getAudioSources}
        chartAssist={chartAssist}
        stemsMixer={{
          stemOrigins: paddedStems,
          onAddStem: input => void handleAddStem(input),
          emptyState: !hasAudio,
        }}
        headerExtra={headerExtra}
        leftPanelChildren={leftPanelChildren}
        stackedPianoRoll={stackedPianoRoll}
      />
    </div>
  );
}
