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
import {
  Loader2,
  AlertCircle,
  FolderOpen,
  Trash2,
  ArrowLeft,
  Music,
} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import ChartDropZone from '@/components/chart-picker/ChartDropZone';
import type {LoadedFiles} from '@/components/chart-picker/chart-file-readers';
import {findAudioFiles} from '@/lib/preview/chorus-chart-processing';
import {
  getAudioAnchor,
  readChartForEditing,
  setAudioAnchor,
} from '@/lib/chart-edit';
import {highestDifficultyTrackKeys} from '@/lib/chart-editor-core';
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
  type ProjectSummary,
  type ProjectMetadata,
} from '@/lib/project-storage/opfsProjectStore';

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
  /** OPFS namespace for this page's projects, and its route path. */
  namespace: string;
  route: string;
  /**
   * Namespaces written by routes that have since been folded into this one.
   * Their projects stay listable and editable in place; new projects are
   * always written to `namespace`.
   */
  legacyNamespaces?: readonly string[];
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
  const {
    namespace,
    route,
    pageTitle,
    pageDescription,
    dropZoneId,
    legacyNamespaces,
  } = config;

  const store = useMemo(
    () =>
      createOpfsProjectStore(namespace, {
        legacyNamespaces: legacyNamespaces ?? [],
      }),
    [namespace, legacyNamespaces],
  );

  const searchParams = useSearchParams();
  const router = useRouter();
  const projectId = searchParams.get('project');

  const [pageState, setPageState] = useState<PageState>(
    projectId ? 'loading-chart' : 'load',
  );

  // Project list for the load screen
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  // projectsLoaded starts false and stays true once we've completed a
  // listProjects() call. loadingProjects is derived from it so the
  // effect below doesn't need to flip a loading flag synchronously.
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const loadingProjects = pageState === 'load' && !projectsLoaded;
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);

  // Load project list when showing the load screen. All state writes
  // happen in the promise callback, so the effect body itself does no
  // synchronous setState.
  useEffect(() => {
    if (pageState !== 'load') return;

    let cancelled = false;
    store
      .listProjects()
      .then(list => {
        if (!cancelled) {
          setProjects(list);
          setProjectsLoaded(true);
        }
      })
      .catch(err => {
        console.warn(`Failed to load ${namespace} projects:`, err);
        if (!cancelled) setProjectsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [pageState, store, namespace]);

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

  // Handle opening an existing project
  const handleOpenProject = useCallback(
    (id: string) => {
      setPageState('loading-chart');
      router.push(`${route}?project=${id}`);
    },
    [router, route],
  );

  // Handle deleting a project
  const handleDeleteProject = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await store.deleteProject(deleteTarget.id);
      setProjects(prev => prev.filter(p => p.id !== deleteTarget.id));
      toast.success(`Deleted "${deleteTarget.name}"`);
    } catch (err) {
      toast.error('Failed to delete project');
      console.error(err);
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, store]);

  // Handle going back to load screen
  const handleBack = useCallback(() => {
    setPageState('load');
    router.push(route);
  }, [router, route]);

  // If there's a project ID in the URL, show the editor
  if (projectId && (pageState === 'loading-chart' || pageState === 'edit')) {
    return (
      <TrackEditEditor
        config={config}
        store={store}
        projectId={projectId}
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

        {/* Drop zone for loading a chart */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Load a Chart</CardTitle>
            <CardDescription>
              Drop a .sng or .zip file, or select a chart folder.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartDropZone
              onLoaded={handleChartLoaded}
              id={dropZoneId}
              disabled={pageState === 'loading-chart'}
            />
          </CardContent>
        </Card>

        {/* Recent projects from OPFS */}
        {(projects.length > 0 || loadingProjects) && (
          <Card>
            <CardHeader>
              <CardTitle>Recent Projects</CardTitle>
              <CardDescription>
                Previously opened charts saved in your browser.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingProjects ? (
                <div className="flex items-center gap-2 py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">
                    Loading projects...
                  </span>
                </div>
              ) : (
                <div className="space-y-2">
                  {projects.map(project => (
                    <div
                      key={project.id}
                      className="flex items-center justify-between rounded-lg border px-4 py-3 hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Music className="h-5 w-5 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {project.name}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {project.artist} &middot;{' '}
                            {new Date(project.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenProject(project.id)}>
                          <FolderOpen className="h-4 w-4 mr-1" />
                          Open
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(project)}>
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={open => {
          if (!open) setDeleteTarget(null);
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{deleteTarget?.name}&rdquo;
              and all its data from your browser. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteProject}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  onBack: () => void;
  onReady: () => void;
}

type LoadingState = 'loading' | 'ready' | 'error';

function TrackEditEditor({
  config,
  store,
  projectId,
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
  // Auto-save: write edited chart to OPFS
  const saveFn = useCallback(async () => {
    if (!state.chartDoc) return;
    await store.writeEditedChart(
      projectId,
      chartDocToChartText(state.chartDoc),
    );
    // Mirror the doc's audio anchor into project metadata: a `.chart` file
    // has nowhere to carry it, and without it a reload would show a chart
    // shifted by the leading silence against unpadded audio. Cheap and
    // idempotent — runs on every autosave.
    await store.updateProject(projectId, {
      audioAnchor: getAudioAnchor(state.chartDoc) ?? null,
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

        // 3. Build the editable ChartDocument. This is the editor's parse:
        // a basic four-lane drum chart is read as pro-drums so the cymbal
        // toggle the editor offers survives the save it writes.
        const chartBytes = new TextEncoder().encode(chartText);
        let chartDoc = readChartForEditing([
          {fileName: 'notes.chart', data: chartBytes},
        ]);
        // 3a. Re-attach the persisted audio anchor (0064 addendum §1)
        // before this doc is ever dispatched, so the padding the chart was
        // saved with is the padding playback and export rebuild from.
        if (meta.audioAnchor) {
          chartDoc = setAudioAnchor(chartDoc, meta.audioAnchor);
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

        // 5. Load audio files from OPFS
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
    () => ({
      ...chartPackage.chartAssist,
      audioSampleRate: PACKAGE_AUDIO_META.sampleRate,
      audioBusyReason: audioRebuilding ? 'Rebuilding audio' : undefined,
    }),
    [chartPackage.chartAssist, audioRebuilding],
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
        songName={projectMeta?.name ?? 'Untitled'}
        artistName={projectMeta?.artist}
        charterName={projectMeta?.charter}
        dirty={state.dirty}
        getChartText={chartPackage.getChartText}
        getAudioSources={getAudioSources}
        chartAssist={chartAssist}
        stemsMixer={{stemOrigins: paddedStems}}
        headerExtra={headerExtra}
        leftPanelChildren={leftPanelChildren}
        stackedPianoRoll={stackedPianoRoll}
      />
    </div>
  );
}
