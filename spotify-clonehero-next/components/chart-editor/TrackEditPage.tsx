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
import {parseChartFile, type IniChartModifiers} from '@eliwhite/scan-chart';

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
import {readChart, writeChartFolder} from '@/lib/chart-edit';
import type {ChartDocument, ParsedTrackData} from '@/lib/chart-edit';
import {AudioManager} from '@/lib/preview/audioManager';
import {getChartDelayMs} from '@/lib/chart-utils/chartDelay';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import {ChartEditorProvider, useChartEditorContext} from './ChartEditorContext';
import type {EditorScope} from './scope';
import ChartEditor from './ChartEditor';
import type {AudioSource} from './ExportDialog';
import {useEditorKeyboard} from './hooks/useEditorKeyboard';
import {useAutoSave} from './hooks/useAutoSave';
import {
  createOpfsProjectStore,
  type ProjectSummary,
  type ProjectMetadata,
} from '@/lib/project-storage/opfsProjectStore';

/**
 * Configuration for a single-instrument chart-edit page (`/drum-edit`,
 * `/guitar-edit`). Everything that differs between those pages — OPFS
 * namespace, default scope, ini modifiers, which track to load, labels —
 * is captured here; `TrackEditPage` implements the shared shell (load
 * screen, OPFS project list, chart loading/parsing, `ChartEditor` mount)
 * once.
 */
export interface TrackEditPageConfig {
  /** OPFS namespace for this page's projects, and its route path. */
  namespace: string;
  route: string;
  /** Scope the editor starts in (instrument/difficulty pair to edit). */
  defaultScope: EditorScope;
  pageTitle: string;
  pageDescription: string;
  dropZoneId: string;
  /** Ini chart modifiers to force on every parse (e.g. `{pro_drums: true}`). */
  iniChartModifiersOverride?: Partial<IniChartModifiers>;
  /**
   * Pick the track to edit from a freshly parsed chart's `trackData`, or
   * `undefined` if the chart has none of this page's instrument. Called
   * both when loading a new chart (existence check) and when opening a
   * saved project (existence check + resolving which difficulty to show).
   */
  findTrack: (
    trackData: ChartDocument['parsedChart']['trackData'],
  ) => ParsedTrackData | undefined;
  /** Error message shown when `findTrack` returns nothing. */
  noTrackMessage: string;
  /** Extra control rendered in the ChartEditor header (e.g. a difficulty picker). */
  headerExtra?: ReactNode;
}

// ---------------------------------------------------------------------------
// Page entry point
// ---------------------------------------------------------------------------

export default function TrackEditPage(config: TrackEditPageConfig) {
  return (
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
    iniChartModifiersOverride,
    findTrack,
    noTrackMessage,
  } = config;

  const store = useMemo(() => createOpfsProjectStore(namespace), [namespace]);

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

        const chartDoc = readChart(files, iniChartModifiersOverride);
        const name =
          chartDoc.parsedChart.metadata.name ?? originalName ?? 'Unknown';
        const artist = chartDoc.parsedChart.metadata.artist ?? 'Unknown';
        const charter = chartDoc.parsedChart.metadata.charter ?? 'Unknown';

        if (!findTrack(chartDoc.parsedChart.trackData)) {
          throw new Error(noTrackMessage);
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
        const chartFiles = writeChartFolder(chartDoc);
        const chartFileEntry = chartFiles.find(
          f => f.fileName === 'notes.chart',
        );
        if (!chartFileEntry) {
          throw new Error('writeChartFolder did not produce notes.chart');
        }
        const chartText = new TextDecoder().decode(chartFileEntry.data);

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
    [router, store, route, iniChartModifiersOverride, findTrack, noTrackMessage],
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
  const {iniChartModifiersOverride, findTrack, noTrackMessage, headerExtra} =
    config;
  const {state, dispatch, audioManagerRef} = useChartEditorContext();
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [loadingStep, setLoadingStep] = useState('Loading project...');
  const [errorMessage, setErrorMessage] = useState('');
  const [projectMeta, setProjectMeta] = useState<ProjectMetadata | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [audioData, setAudioData] = useState<Float32Array | null>(null);
  const [audioChannels, setAudioChannels] = useState(2);
  // Mirrors audioManagerRef (shared via context for event-handler reads)
  // into render-visible state so the CloneHeroRenderer prop is passed
  // without reading ref.current during render.
  const [audioManager, setAudioManager] = useState<AudioManager | null>(null);

  // Auto-save: write edited chart to OPFS
  const saveFn = useCallback(async () => {
    if (!state.chartDoc) return;
    const files = writeChartFolder(state.chartDoc);
    const chartFile = files.find(f => f.fileName === 'notes.chart');
    if (!chartFile) return;
    const chartText = new TextDecoder().decode(chartFile.data);
    await store.writeEditedChart(projectId, chartText);
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
        setDurationSeconds(meta.durationSeconds);

        // 2. Load chart text (prefer edited, fallback to original)
        setLoadingStep('Loading chart data...');
        const chartText = await store.readChartText(projectId);
        if (cancelled) return;

        // 3. Parse chart
        const chartBytes = new TextEncoder().encode(chartText);
        const parsed = parseChartFile(
          chartBytes,
          'chart',
          iniChartModifiersOverride,
        );

        // 4. Find the track to edit — prefer the default scope's
        // difficulty, else whatever findTrack resolves. If the resolved
        // track's difficulty differs from the current scope, switch scope
        // to match so the highway/header reflect what's actually loaded.
        const track = findTrack(parsed.trackData);
        if (!track) {
          throw new Error(
            `${noTrackMessage} Available tracks: ` +
              parsed.trackData
                .map(t => `${t.instrument}/${t.difficulty}`)
                .join(', '),
          );
        }
        const currentScope = state.activeScope;
        if (
          currentScope.kind !== 'track' ||
          currentScope.track.instrument !== track.instrument ||
          currentScope.track.difficulty !== track.difficulty
        ) {
          dispatch({
            type: 'SET_ACTIVE_SCOPE',
            scope: {
              kind: 'track',
              track: {
                instrument: track.instrument,
                difficulty: track.difficulty,
              },
            },
          });
        }

        // 5. Build editable ChartDocument.
        const chartDoc = readChart(
          [{fileName: 'notes.chart', data: chartBytes}],
          iniChartModifiersOverride,
        );

        // 6. Load audio files from OPFS
        setLoadingStep('Loading audio...');
        const audioFiles = await store.loadAudioFiles(projectId);
        if (cancelled) return;

        if (audioFiles.length === 0) {
          throw new Error('No audio files found in project storage');
        }

        // 7. Create AudioManager
        setLoadingStep('Preparing audio playback...');
        const audioManager = new AudioManager(audioFiles, () => {
          dispatch({type: 'SET_PLAYING', isPlaying: false});
        });
        await audioManager.ready;
        if (cancelled) return;

        audioManager.setChartDelay(
          getChartDelayMs(chartDoc.parsedChart.metadata) / 1000,
        );
        audioManagerRef.current = audioManager;
        setAudioManager(audioManager);

        // 8. Decode first audio file to raw PCM for waveform display
        try {
          const waveformCtx = new AudioContext({sampleRate: 44100});
          const firstAudio = audioFiles[0];
          const buf = firstAudio.data.slice(0).buffer;
          const decoded = await waveformCtx.decodeAudioData(buf as ArrayBuffer);
          const channels = decoded.numberOfChannels;
          // Interleave channels into a single Float32Array
          const length = decoded.length;
          const interleaved = new Float32Array(length * channels);
          for (let ch = 0; ch < channels; ch++) {
            const channelData = decoded.getChannelData(ch);
            for (let i = 0; i < length; i++) {
              interleaved[i * channels + ch] = channelData[i];
            }
          }
          setAudioData(interleaved);
          setAudioChannels(channels);
          await waveformCtx.close();
        } catch {
          // Waveform is optional — don't fail the whole load
          console.warn('Could not decode audio for waveform display');
        }
        if (cancelled) return;

        // 9. Update editor state. ChartDoc carries the parsed chart;
        // consumers derive the active track via selectActiveTrack().
        dispatch({type: 'SET_CHART_DOC', chartDoc});
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
      audioManagerRef.current?.destroy();
      audioManagerRef.current = null;
      setAudioManager(null);
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

  // Export: provide chart text
  const getChartText = useCallback(async (): Promise<string> => {
    if (!state.chartDoc) throw new Error('No chart document');
    const files = writeChartFolder(state.chartDoc);
    const chartFile = files.find(f => f.fileName === 'notes.chart');
    if (!chartFile)
      throw new Error('writeChartFolder did not produce notes.chart');
    return new TextDecoder().decode(chartFile.data);
  }, [state.chartDoc]);

  // Export: provide audio sources (original audio files from the package).
  // This page has no separated stems, so the stem preference is ignored.
  const getAudioSources = useCallback(async (): Promise<AudioSource[]> => {
    const audioFiles = await store.loadAudioFiles(projectId);
    return audioFiles.map(f => ({
      fileName: f.fileName,
      data: f.data.buffer as ArrayBuffer,
    }));
  }, [projectId, store]);

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
    <div className="h-screen w-screen flex flex-col">
      <ChartEditor
        metadata={cloneHeroMetadata}
        chart={chart}
        audioManager={audioManager}
        audioData={audioData ?? undefined}
        audioChannels={audioChannels}
        durationSeconds={durationSeconds}
        sections={chart.sections}
        songName={projectMeta?.name ?? 'Untitled'}
        artistName={projectMeta?.artist}
        charterName={projectMeta?.charter}
        dirty={state.dirty}
        getChartText={getChartText}
        getAudioSources={getAudioSources}
        headerExtra={headerExtra}
      />
    </div>
  );
}
