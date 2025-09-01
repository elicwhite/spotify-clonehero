import {Difficulty} from 'scan-chart';

import {Button} from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {Label} from '@/components/ui/label';
import {Slider} from '@/components/ui/slider';
import {Switch} from '@/components/ui/switch';
import {
  ArrowLeft,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Menu,
  X,
  Settings2,
  Target,
  Plus,
  Minus,
  RotateCcw,
  Star,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
} from 'react';
import {useRouter} from 'next/navigation';
import useInterval from 'use-interval';
import {ChartResponseEncore} from '@/lib/chartSelection';

import {getBasename} from '@/lib/src-shared/utils';
import {cn} from '@/lib/utils';
import SheetMusic from './SheetMusic';
import {Files, ParsedChart} from '@/lib/preview/chorus-chart-processing';
import {AudioManager, PracticeModeConfig} from '@/lib/preview/audioManager';
import CloneHeroRenderer from './CloneHeroRenderer';
import Link from 'next/link';
import Image from 'next/image';
import {generateClickTrackFromMeasures} from './generateClickTrack';
import type {ClickVolumes} from './generateClickTrack';
import convertToVexFlow from './convertToVexflow';
import debounce from 'debounce';
import wholeNote from '@/public/assets/svgs/whole-note.svg';
import quarterNote from '@/public/assets/svgs/quarter-note.svg';
import eighthNote from '@/public/assets/svgs/eighth-note.svg';
import tripletNote from '@/public/assets/svgs/triplet-note.svg';
import {extractFills, defaultConfig} from '@/lib/fill-detector';
import {toast} from '@/components/ui/toast';
import {createClient} from '@/lib/supabase/client';
import {
  saveSongByHash,
  savePracticeSection,
  getPracticeSections,
} from './actions';

function getDrumDifficulties(chart: ParsedChart): Difficulty[] {
  return chart.trackData
    .filter(part => part.instrument === 'drums')
    .map(part => part.difficulty);
}

function capitalize(fileName: string): string {
  return fileName[0].toUpperCase() + getBasename(fileName).slice(1);
}

interface VolumeControl {
  trackName: string;
  volume: number;
  previousVolume?: number;
  isMuted: boolean;
  isSoloed: boolean;
}

function formatSeconds(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(
    Math.floor(seconds % 60),
  ).padStart(2, '0')}`;
}
export default function Renderer({
  metadata,
  chart,
  audioFiles,
}: {
  metadata: ChartResponseEncore;
  chart: ParsedChart;
  audioFiles: Files;
}) {
  const SETTINGS_KEY = 'sheetMusic.songView.settings.v1';
  const TRACK_SETTINGS_KEY = 'sheetMusic.songView.trackVolumes.v1';

  type PersistedSettings = {
    selectedDifficulty?: Difficulty;
    playClickTrack?: boolean;
    masterClickVolume?: number;
    clickVolumes?: ClickVolumes;
    showBarNumbers?: boolean;
    enableColors?: boolean;
    showLyrics?: boolean;
    viewCloneHero?: boolean;
    tempo?: number;
  };
  const [playClickTrack, setPlayClickTrack] = useState(true);
  const [clickTrackConfigurationOpen, setClickTrackConfigurationOpen] =
    useState(false);
  const [masterClickVolume, setMasterClickVolume] = useState(0.7);
  const [clickVolumes, setClickVolumes] = useState<ClickVolumes>({
    wholeNote: 1,
    quarterNote: 0.75, //0.75,
    eighthNote: 0.1, // 0.5,
    tripletNote: 0,
  });

  const [showBarNumbers, setShowBarNumbers] = useState(false);
  const [enableColors, setEnableColors] = useState(true);
  const [showLyrics, setShowLyrics] = useState(true);
  const [viewCloneHero, setViewCloneHero] = useState(false);
  const [currentPlayback, setCurrentPlayback] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volumeControls, setVolumeControls] = useState<VolumeControl[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [detectedFills, setDetectedFills] = useState<
    Array<{
      fillNumber: number;
      startTimeMs: number;
      endTimeMs: number;
      durationMs: number;
      startTick: number;
      endTick: number;
      measureStartMs: number;
      measureNumber: number;
    }>
  >([]);

  // Tempo control state
  const [tempo, setTempo] = useState(1.0);

  // Practice mode state
  const [practiceMode, setPracticeMode] = useState<PracticeModeConfig | null>(
    null,
  );

  const practiceModeEnabled =
    practiceMode != null && practiceMode.endTimeMs > 0;
  const [practiceModeStep, setPracticeModeStep] = useState<
    'idle' | 'selectingStart' | 'selectingEnd'
  >('idle');

  const [savedSections, setSavedSections] = useState<
    Array<{id: string; start_ms: number; end_ms: number}>
  >([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const availableDifficulties = getDrumDifficulties(chart);
  const [selectedDifficulty, setSelectedDifficulty] = useState(
    availableDifficulties[0],
  );

  const audioManagerRef = useRef<AudioManager | null>(null);
  const router = useRouter();

  const handleMasterClickVolumeChange = (value: number) => {
    if (playClickTrack) {
      audioManagerRef.current?.setVolume('click', value);
    }
    setMasterClickVolume(value);
  };

  const updatePlayClickTrack = (value: boolean) => {
    audioManagerRef.current?.setVolume('click', value ? masterClickVolume : 0);
    setPlayClickTrack(value);
  };

  const handleClickVolumeChange = useMemo(
    () =>
      debounce((value: number, key: keyof typeof clickVolumes) => {
        setClickVolumes(prev => ({...prev, [key]: value}));
      }, 300),
    [setClickVolumes],
  );

  // Tempo control handlers
  const handleTempoChange = (newTempo: number) => {
    if (audioManagerRef.current) {
      audioManagerRef.current.setTempo(newTempo);
      setTempo(newTempo);
    }
  };

  const handleSpeedUp = () => {
    if (audioManagerRef.current) {
      const newTempo = audioManagerRef.current.speedUp();
      setTempo(newTempo);
    }
  };

  const handleSlowDown = () => {
    if (audioManagerRef.current) {
      const newTempo = audioManagerRef.current.slowDown();
      setTempo(newTempo);
    }
  };

  const handleResetSpeed = () => {
    if (audioManagerRef.current) {
      audioManagerRef.current.resetSpeed();
      setTempo(1.0);
    }
  };

  // Authentication check for save functionality
  const handleSaveClick = async () => {
    try {
      const supabase = createClient();
      const {
        data: {user},
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        // User not authenticated, redirect to login with current page as next
        const currentPath = window.location.pathname;
        router.push(`/auth/login?next=${encodeURIComponent(currentPath)}`);
        return;
      }

      // Call server action to persist
      const result = await saveSongByHash(metadata.md5, selectedDifficulty);
      if (!result?.ok) {
        toast.error(result?.error ?? 'Failed to save song');
        return;
      }
      toast.success('Song saved');
    } catch (error) {
      console.error('Authentication check failed:', error);
      toast.error('Failed to check authentication');
    }
  };

  const handleSaveSection = async () => {
    if (!practiceMode) return;
    if (!practiceMode || practiceMode.endMeasureMs === 0) {
      return;
    }
    const result = await savePracticeSection(
      metadata.md5,
      selectedDifficulty,
      practiceMode.startMeasureMs,
      practiceMode.endMeasureMs,
    );
    if (!result?.ok) {
      toast.error(result?.error ?? 'Failed to save section');
      return;
    }
    toast.success('Section saved');
    const res = await getPracticeSections(metadata.md5, selectedDifficulty);
    if (res?.ok)
      setSavedSections(
        (res.sections ?? []).filter(
          s => s.start_ms != null && s.end_ms != null,
        ) as Array<{id: string; start_ms: number; end_ms: number}>,
      );
  };

  const loadSection = useCallback(
    (section: {start_ms: number; end_ms: number}) => {
      const startMs = section.start_ms;
      const endMs = section.end_ms;
      const config: PracticeModeConfig = {
        startMeasureMs: startMs,
        endMeasureMs: endMs,
        startTimeMs: Math.max(0, startMs - 500),
        endTimeMs: endMs + 500,
      };
      setPracticeMode(config);
      setPracticeModeStep('idle');
      audioManagerRef.current?.setPracticeMode(config);
    },
    [],
  );

  // const clickTrack = useMemo(async () => {
  //   const clickTrack = await generateClickTrack(metadata, chart);
  //   console.log(clickTrack);
  // }, [chart]);

  const instrument = 'drums';

  const track: ParsedChart['trackData'][0] = useMemo(() => {
    const drumPart = chart.trackData.find(
      part =>
        part.instrument === instrument &&
        part.difficulty === selectedDifficulty,
    );
    if (!drumPart) {
      throw new Error('Unable to find difficulty');
    }
    return drumPart;
  }, [chart, selectedDifficulty, instrument]);

  const measures = useMemo(() => {
    return convertToVexFlow(chart, track);
  }, [chart, track]);

  const lastAudioState = useRef({
    currentTime: 0,
    wasPlaying: false,
  });

  // Load persisted settings on first mount
  const hasLoadedSettingsRef = useRef(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  useEffect(() => {
    if (hasLoadedSettingsRef.current) return;
    hasLoadedSettingsRef.current = true;
    try {
      if (typeof window === 'undefined') return;
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed: PersistedSettings = JSON.parse(raw);

        if (parsed.playClickTrack !== undefined) {
          setPlayClickTrack(parsed.playClickTrack);
        }
        if (parsed.masterClickVolume !== undefined) {
          setMasterClickVolume(parsed.masterClickVolume);
        }
        if (parsed.clickVolumes) {
          setClickVolumes(prev => ({...prev, ...parsed.clickVolumes!}));
        }
        if (parsed.enableColors !== undefined) {
          setEnableColors(parsed.enableColors);
        }
        if (parsed.showLyrics !== undefined) {
          setShowLyrics(parsed.showLyrics);
        }
        if (parsed.viewCloneHero !== undefined) {
          setViewCloneHero(parsed.viewCloneHero);
        }
        if (parsed.showBarNumbers !== undefined) {
          setShowBarNumbers(parsed.showBarNumbers);
        }
        if (
          parsed.selectedDifficulty &&
          availableDifficulties.includes(parsed.selectedDifficulty)
        ) {
          setSelectedDifficulty(parsed.selectedDifficulty);
        }

        // Restore tempo if available
        if (parsed.tempo) {
          setTempo(parsed.tempo);
        }
      }
    } catch (e) {
      // noop on parse errors
    }
    setSettingsLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist settings whenever they change
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const settingsToPersist: PersistedSettings = {
      selectedDifficulty,
      playClickTrack,
      masterClickVolume,
      clickVolumes,
      showBarNumbers,
      enableColors,
      showLyrics,
      viewCloneHero,
      tempo,
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsToPersist));
    } catch (e) {
      // ignore write errors
    }
  }, [
    selectedDifficulty,
    playClickTrack,
    masterClickVolume,
    clickVolumes,
    showBarNumbers,
    enableColors,
    showLyrics,
    viewCloneHero,
    tempo,
  ]);

  useEffect(() => {
    // Wait for settings to be loaded before initializing audio manager
    if (!settingsLoaded) return;

    async function run() {
      const clickTrack = await generateClickTrackFromMeasures(
        measures,
        clickVolumes,
      );
      const files = [
        ...audioFiles,
        {
          fileName: 'click.mp3',
          data: clickTrack,
        },
      ];
      const audioManager = new AudioManager(files, () => {
        setIsPlaying(false);
      });

      const processedTracks = new Set();
      let initialVolumeControls: VolumeControl[] = [];

      files.forEach(audioFile => {
        if (audioFile.fileName.includes('click')) {
          return;
        }
        const basename = getBasename(audioFile.fileName);
        const trackName = basename.includes('drums') ? 'drums' : basename;

        if (!processedTracks.has(trackName)) {
          processedTracks.add(trackName);
          initialVolumeControls.push({
            trackName,
            volume: 1,
            isMuted: false,
            isSoloed: false,
          });
        }
      });

      // Merge with any persisted track volumes
      try {
        if (typeof window !== 'undefined') {
          const raw = localStorage.getItem(TRACK_SETTINGS_KEY);
          if (raw) {
            const persisted: Record<
              string,
              Partial<VolumeControl>
            > = JSON.parse(raw);
            initialVolumeControls = initialVolumeControls.map(control => {
              const saved = persisted[control.trackName];
              if (!saved) return control;
              return {
                ...control,
                ...saved,
                // Ensure required fields are present
                trackName: control.trackName,
                volume:
                  typeof saved.volume === 'number'
                    ? saved.volume
                    : control.volume,
                isMuted:
                  typeof saved.isMuted === 'boolean'
                    ? saved.isMuted
                    : control.isMuted,
                isSoloed:
                  typeof saved.isSoloed === 'boolean'
                    ? saved.isSoloed
                    : control.isSoloed,
                previousVolume:
                  typeof saved.previousVolume === 'number'
                    ? saved.previousVolume
                    : control.previousVolume,
              };
            });
          }
        }
      } catch {}

      setVolumeControls(initialVolumeControls);

      audioManager.ready.then(() => {
        if (audioManagerRef.current) {
          // This effect already ran and has been set up before we got here. Bail.
          return;
        }
        audioManager.setVolume('click', playClickTrack ? masterClickVolume : 0);
        audioManagerRef.current = audioManager;
        window.am = audioManager;

        // Restore practice mode configuration if it exists
        if (practiceMode && practiceMode.endMeasureMs > 0) {
          audioManager.setPracticeMode(practiceMode);
        }

        // Apply initial per-track volumes loaded from storage
        try {
          initialVolumeControls.forEach(control => {
            audioManager.setVolume(control.trackName, control.volume);
          });
        } catch {}

        // Apply initial tempo configuration
        try {
          audioManager.setTempo(tempo);
        } catch {}

        if (lastAudioState.current.wasPlaying) {
          audioManager.play({time: lastAudioState.current.currentTime});
          setIsPlaying(true);
        }
      });
    }
    run();

    return () => {
      lastAudioState.current = {
        currentTime: audioManagerRef.current?.currentTime ?? 0,
        wasPlaying: audioManagerRef.current?.isPlaying ?? false,
      };
      audioManagerRef.current?.destroy();
      audioManagerRef.current = null;
    };
  }, [
    audioFiles,
    measures,
    clickVolumes,
    playClickTrack,
    masterClickVolume,
    practiceMode,
    settingsLoaded,
  ]);

  useInterval(
    () => {
      setCurrentPlayback(audioManagerRef.current?.currentTime ?? 0);

      // Check for practice mode looping
      if (audioManagerRef.current && isPlaying) {
        audioManagerRef.current.checkPracticeModeLoop();
      }
    },
    isPlaying ? 100 : null,
  );

  useEffect(() => {
    if (volumeControls.length === 0 || audioManagerRef.current == null) {
      return;
    }

    volumeControls.forEach(control => {
      audioManagerRef.current?.setVolume(control.trackName, control.volume);
    });
  }, [volumeControls, audioManagerRef]);

  // Persist per-track volumes whenever they change
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const map: Record<string, Partial<VolumeControl>> = {};
      for (const vc of volumeControls) {
        map[vc.trackName] = {
          volume: vc.volume,
          isMuted: vc.isMuted,
          isSoloed: vc.isSoloed,
          previousVolume: vc.previousVolume,
        };
      }
      localStorage.setItem(TRACK_SETTINGS_KEY, JSON.stringify(map));
    } catch {}
  }, [volumeControls]);

  // Update document title when metadata changes
  useEffect(() => {
    if (metadata?.name && metadata?.artist) {
      document.title = `${metadata.name} by ${metadata.artist} - musiccharts.tools`;
    }
  }, [metadata]);

  // Run fill detection when chart and track are loaded (dev mode only)
  useEffect(() => {
    // Only run fill detection in development mode
    if (process.env.NODE_ENV !== 'development') {
      return;
    }

    try {
      // Only run fill detection if we have a drums track
      if (track.instrument !== 'drums') {
        setDetectedFills([]); // Clear fills for non-drums tracks
        return;
      }

      const fills = extractFills(chart, track, defaultConfig);

      // Store fills in state for UI
      const fillsForUI = fills.map((fill, index) => ({
        fillNumber: index + 1,
        startTimeMs: fill.startMs,
        endTimeMs: fill.endMs,
        durationMs: fill.endMs - fill.startMs,
        startTick: fill.startTick,
        endTick: fill.endTick,
        measureStartMs: fill.measureStartMs,
        measureNumber: fill.measureNumber,
      }));
      setDetectedFills(fillsForUI);

      console.log('🥁 Detected Drum Fills Debug Info:', {
        songName: metadata.name,
        artist: metadata.artist,
        charter: metadata.charter,
        difficulty: track.difficulty,
        totalFills: fills.length,
        fillDetails: fills.map((fill, index) => ({
          fillNumber: index + 1,
          measureNumber: fill.measureNumber,
          measureStartMs: fill.measureStartMs,
          startTick: fill.startTick,
          endTick: fill.endTick,
          startTimeMs: fill.startMs,
          endTimeMs: fill.endMs,
          durationMs: fill.endMs - fill.startMs,
          durationBeats: (fill.endTick - fill.startTick) / chart.resolution,
          scores: {
            densityZ: fill.densityZ,
            grooveDistance: fill.grooveDist,
            tomRatioJump: fill.tomRatioJump,
            hatDropout: fill.hatDropout,
            kickDrop: fill.kickDrop,
            ioiStdZ: fill.ioiStdZ,
            ngramNovelty: fill.ngramNovelty,
            samePadBurst: fill.samePadBurst,
            crashResolve: fill.crashResolve,
          },
          combinedScore: fill.densityZ + fill.grooveDist + fill.tomRatioJump,
        })),
        summary:
          fills.length > 0
            ? {
                shortestFillMs: Math.min(
                  ...fills.map(f => f.endMs - f.startMs),
                ),
                longestFillMs: Math.max(...fills.map(f => f.endMs - f.startMs)),
                avgFillDurationMs:
                  fills.reduce((sum, f) => sum + (f.endMs - f.startMs), 0) /
                  fills.length,
                totalFillTimeMs: fills.reduce(
                  (sum, f) => sum + (f.endMs - f.startMs),
                  0,
                ),
              }
            : null,
      });
    } catch (error) {
      console.warn('⚠️ Fill detection failed:', error);
      console.log('Chart structure for debugging:', {
        trackInstrument: track.instrument,
        trackDifficulty: track.difficulty,
        hasTempos: !!chart.tempos,
        tempoCount: chart.tempos?.length || 0,
        resolution: chart.resolution,
      });
      setDetectedFills([]); // Clear fills on error
    }
  }, [chart, track, metadata]);

  // Function to play from a specific fill
  const playFill = useCallback((fillStartTimeMs: number) => {
    if (audioManagerRef.current == null) {
      return;
    }
    // Convert milliseconds to seconds for audio manager
    const timeInSeconds = fillStartTimeMs / 1000;
    audioManagerRef.current.play({time: timeInSeconds});
    setIsPlaying(true);
  }, []);

  // Function to play from the start of the measure containing a fill
  const playFromMeasure = useCallback((measureStartTimeMs: number) => {
    if (audioManagerRef.current == null) {
      return;
    }
    // Convert milliseconds to seconds for audio manager
    const timeInSeconds = measureStartTimeMs / 1000;
    audioManagerRef.current.play({time: timeInSeconds});
    setIsPlaying(true);
  }, []);

  // Modify the play function to handle practice mode
  const handlePlay = useCallback(() => {
    if (!audioManagerRef.current) {
      return;
    }

    if (isPlaying) {
      audioManagerRef.current.pause();
      setIsPlaying(false);
    } else if (!audioManagerRef.current.isInitialized) {
      // If in practice mode, start from practice start time
      if (practiceModeEnabled) {
        audioManagerRef.current.play({time: practiceMode.startTimeMs / 1000});
      } else {
        audioManagerRef.current.play({time: 0});
      }
      setIsPlaying(true);
    } else {
      audioManagerRef.current.resume();
      setIsPlaying(true);
    }
  }, [isPlaying, practiceMode, practiceModeEnabled]);

  // Practice mode functions
  const startPracticeMode = useCallback(() => {
    setPracticeModeStep('selectingStart');
    toast.info('Choose the starting measure');
  }, []);

  const endPracticeMode = useCallback(() => {
    setPracticeMode(null);
    setPracticeModeStep('idle');

    // Update audio manager
    if (audioManagerRef.current) {
      audioManagerRef.current.setPracticeMode(null);
    }

    toast.info('Practice mode ended');
  }, []);

  const handlePracticeMeasureSelect = useCallback(
    (measureStartMs: number) => {
      if (practiceModeStep === 'selectingStart') {
        // Set start measure and move to selecting end
        setPracticeMode({
          startMeasureMs: measureStartMs,
          endMeasureMs: 0,
          startTimeMs: Math.max(0, measureStartMs - 500), // 2 seconds before
          endTimeMs: 0,
        });
        setPracticeModeStep('selectingEnd');
        toast.info('Choose the ending measure');
      } else if (practiceModeStep === 'selectingEnd') {
        // Set end measure and complete practice mode setup
        const endMeasureMs = measureStartMs;
        const updatedPracticeMode: PracticeModeConfig = {
          startMeasureMs: practiceMode!.startMeasureMs,
          endMeasureMs: endMeasureMs,
          startTimeMs: practiceMode!.startTimeMs,
          endTimeMs: endMeasureMs + 500, // 500ms after
        };

        setPracticeMode(updatedPracticeMode);
        setPracticeModeStep('idle');

        // Update audio manager
        if (audioManagerRef.current) {
          audioManagerRef.current.setPracticeMode(updatedPracticeMode);
        }

        toast.success(
          'Practice mode configured! Click play to start practicing.',
        );
      }
    },
    [practiceModeStep, practiceMode],
  );

  const songDuration =
    metadata.song_length == null ? 5 * 60 : metadata.song_length / 1000;

  const difficultySelectorOnSelect = useCallback(
    (selectedDifficulty: string) => {
      setSelectedDifficulty(selectedDifficulty as Difficulty);
    },
    [],
  );

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({data: {user}}) => {
      setIsAuthenticated(!!user);
    });
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    getPracticeSections(metadata.md5, selectedDifficulty).then(res => {
      if (res?.ok) {
        setSavedSections(
          (res.sections ?? []).filter(
            s => s.start_ms != null && s.end_ms != null,
          ) as Array<{id: string; start_ms: number; end_ms: number}>,
        );
      }
    });
  }, [isAuthenticated, metadata.md5, selectedDifficulty]);

  const volumeSliders = useMemo(() => {
    if (volumeControls.length === 0) {
      return [];
    }

    return volumeControls
      .sort((a, b) => a.trackName.localeCompare(b.trackName))
      .map(control => {
        return (
          <AudioVolume
            key={control.trackName}
            name={control.trackName}
            volume={control.volume}
            isMuted={control.isMuted}
            isSoloed={control.isSoloed}
            onMuteClick={() => {
              if (control.isMuted) {
                setVolumeControls([
                  ...volumeControls.filter(c => c !== control),
                  {
                    ...control,
                    volume: control.previousVolume ?? 100,
                    previousVolume: undefined,
                    isMuted: false,
                  },
                ]);
              } else {
                setVolumeControls([
                  ...volumeControls.filter(c => c !== control),
                  {
                    ...control,
                    volume: 0,
                    previousVolume: control.volume,
                    isMuted: true,
                  },
                ]);
              }
            }}
            onSoloClick={() => {
              const otherControls = volumeControls.filter(c => c !== control);

              if (otherControls.filter(c => c.isSoloed).length > 0) {
                if (control.isSoloed) {
                  setVolumeControls([
                    ...otherControls,
                    {
                      ...control,
                      isSoloed: false,
                      isMuted: true,
                      volume: 0,
                      previousVolume: control.volume,
                    },
                  ]);
                } else {
                  setVolumeControls([
                    ...otherControls,
                    {
                      ...control,
                      isSoloed: true,
                      isMuted: false,
                      volume: control.previousVolume ?? 100,
                      previousVolume: undefined,
                    },
                  ]);
                }

                return;
              }

              if (control.isSoloed) {
                setVolumeControls([
                  ...otherControls.map(c => ({
                    ...c,
                    isMuted: false,
                    previousVolume: undefined,
                    volume: c.previousVolume ?? 100,
                  })),
                  {
                    ...control,
                    isSoloed: false,
                  },
                ]);
              } else {
                setVolumeControls([
                  ...otherControls.map(c => ({
                    ...c,
                    isMuted: true,
                    previousVolume: c.volume,
                    volume: 0,
                  })),
                  {
                    ...control,
                    isSoloed: true,
                  },
                ]);
              }
            }}
            onChange={value => {
              setVolumeControls([
                ...volumeControls.filter(c => c !== control),
                {...control, volume: value},
              ]);
            }}
          />
        );
      });
  }, [volumeControls]);

  // Define reusable control elements
  const backButton = (
    <Link href="/sheet-music">
      <Button variant="ghost" size="icon" className="rounded-full">
        <ArrowLeft className="h-6 w-6" />
      </Button>
    </Link>
  );

  const playPauseButton = (
    <Button
      size="icon"
      variant="secondary"
      className="rounded-full"
      onClick={handlePlay}>
      {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
    </Button>
  );

  const menuToggleButton = (
    <Button
      variant="ghost"
      size="icon"
      className="rounded-full"
      onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
      {isSidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
    </Button>
  );

  // Add practice mode button to the sidebar
  const practiceModeButton = (
    <div className="space-y-2 pt-4 border-t">
      <Button
        variant={
          practiceModeEnabled || practiceModeStep !== 'idle'
            ? 'destructive'
            : 'default'
        }
        className="w-full"
        onClick={practiceModeEnabled ? endPracticeMode : startPracticeMode}>
        <Target className="h-4 w-4 mr-2" />
        {practiceModeEnabled ? 'End Practice' : 'Practice'}
      </Button>
      {practiceModeEnabled && practiceMode && (
        <>
          <div className="text-xs text-muted-foreground text-center">
            Practice Range: {Math.round(practiceMode.startTimeMs / 1000)}s -{' '}
            {Math.round(practiceMode.endTimeMs / 1000)}s
          </div>
          {isAuthenticated && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={handleSaveSection}>
              Save Section
            </Button>
          )}
        </>
      )}
      {isAuthenticated && savedSections.length > 0 && (
        <div className="space-y-1">
          {savedSections.map(section => (
            <Button
              key={section.id}
              variant="outline"
              className="w-full text-xs"
              onClick={() => loadSection(section)}>
              {formatSeconds(section.start_ms / 1000)} -{' '}
              {formatSeconds(section.end_ms / 1000)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="md:overflow-hidden flex flex-col flex-1 md:flex-row bg-background relative">
      {/* Mobile overlay */}
      {isSidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar */}
      <div
        className={cn(
          'w-64 border-r p-4 flex flex-col gap-6 bg-background z-40',
          'fixed inset-y-0 left-0 transition-transform duration-300 ease-in-out',
          'md:static md:translate-x-0 md:h-full',
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}>
        <div className="md:flex hidden items-center gap-2">
          {backButton}
          {playPauseButton}
          {/* <Button variant="ghost" size="icon" className="rounded-full">
            <Maximize2 className="h-6 w-6" />
          </Button> */}
        </div>

        <div className="space-y-4 overflow-y-auto">
          <div className="space-y-2">
            <label className="text-sm font-medium">Difficulty</label>
            <Select
              value={selectedDifficulty}
              onValueChange={difficultySelectorOnSelect}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableDifficulties.map(difficulty => (
                  <SelectItem key={difficulty} value={difficulty}>
                    {capitalize(difficulty)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {volumeSliders}

          <div className="space-y-4 pt-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="clicktrack"
                checked={playClickTrack}
                onCheckedChange={updatePlayClickTrack}
              />
              <label htmlFor="clicktrack" className="text-sm font-medium">
                Enable click track
              </label>
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6"
                onClick={() => setClickTrackConfigurationOpen(true)}>
                <Settings2 className="h-3 w-3" />
              </Button>
              <ClickDialog
                open={clickTrackConfigurationOpen}
                setOpen={setClickTrackConfigurationOpen}
                clickVolumes={clickVolumes}
                handleClickVolumeChange={handleClickVolumeChange}
                masterClickVolume={masterClickVolume}
                setMasterClickVolume={handleMasterClickVolumeChange}
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="colors"
                checked={enableColors}
                onCheckedChange={setEnableColors}
              />
              <label htmlFor="colors" className="text-sm font-medium">
                Enable colors
              </label>
            </div>
            {(chart as any).lyrics == null ? null : (
              <div className="flex items-center space-x-2">
                <Switch
                  id="lyrics"
                  checked={showLyrics}
                  onCheckedChange={setShowLyrics}
                />
                <label htmlFor="lyrics" className="text-sm font-medium">
                  Show lyrics
                </label>
              </div>
            )}
            <div className="flex items-center space-x-2">
              <Switch
                id="clonehero"
                checked={viewCloneHero}
                onCheckedChange={setViewCloneHero}
              />
              <label htmlFor="clonehero" className="text-sm font-medium">
                View as Clone Hero
              </label>
            </div>
            {process.env.NODE_ENV === 'development' && (
              <div className="flex items-center space-x-2">
                <Switch
                  id="measurenumbers"
                  checked={showBarNumbers}
                  onCheckedChange={setShowBarNumbers}
                />
                <label htmlFor="measurenumbers" className="text-sm font-medium">
                  Show measure numbers
                </label>
              </div>
            )}
          </div>

          {/* Tempo Control */}
          <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Speed</span>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    const newTempo = Math.max(tempo - 0.1, 0.25);
                    handleTempoChange(newTempo);
                  }}
                  className="h-6 w-6">
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="text-sm font-mono bg-muted px-2 py-1 rounded min-w-[3rem] text-center">
                  {Math.round(tempo * 100)}%
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    const newTempo = Math.min(tempo + 0.1, 4.0);
                    handleTempoChange(newTempo);
                  }}
                  className="h-6 w-6">
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>

          {/* Practice Mode Button */}
          {practiceModeButton}

          {/* Drum Fills Section - Only in development */}
          {false &&
            process.env.NODE_ENV === 'development' &&
            detectedFills.length > 0 && (
              <div className="space-y-2 pt-4 border-t">
                <label className="text-sm font-medium">
                  Drum Fills ({detectedFills.length})
                </label>
                <div className="space-y-1 overflow-y-auto">
                  {detectedFills.map(fill => (
                    <div
                      key={fill.fillNumber}
                      className="flex items-center justify-between p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">
                          Fill #{fill.fillNumber}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Measure {fill.measureNumber} •{' '}
                          {Math.round(fill.startTimeMs / 1000)}s •{' '}
                          {Math.round(fill.durationMs / 1000)}s duration
                        </div>
                      </div>
                      <div className="flex gap-1 ml-2 flex-shrink-0">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => playFromMeasure(fill.measureStartMs)}
                          title={`Play from measure ${fill.measureNumber} start`}>
                          <Play className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => playFill(fill.startTimeMs)}
                          title={`Play from fill #${fill.fillNumber} start`}>
                          <Play className="h-3 w-3 fill-current" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
        </div>
        <p className="text-xs text-muted-foreground text-center mt-auto">
          Special thanks to{' '}
          <a href="https://github.com/tonygoldcrest">@tonygoldcrest</a>&apos;s{' '}
          <a href="https://github.com/tonygoldcrest/drum-hero">drum-hero</a> for
          providing much of this tool.
        </p>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col md:overflow-hidden">
        {/* Mobile controls - sticky on scroll */}
        <div className="md:hidden sticky top-0 z-20 flex items-center gap-2 md:px-4 py-3 border-b bg-background/95 backdrop-blur-sm">
          {backButton}
          {playPauseButton}
          <div className="ml-auto">{menuToggleButton}</div>
        </div>

        <div className="h-12 border-b flex items-center md:px-4 gap-4 md:static sticky top-[60px] z-20 bg-background/95 backdrop-blur-sm">
          <Slider
            value={[currentPlayback]}
            max={songDuration || 100}
            min={0}
            onValueChange={values => {
              const newTime = values[0];
              setCurrentPlayback(newTime);
              if (audioManagerRef.current) {
                audioManagerRef.current.play({
                  time: newTime,
                });
                setIsPlaying(true);
              }
            }}
          />
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {formatSeconds(currentPlayback)} /{' '}
            {formatSeconds((metadata.song_length || 0) / 1000)}
          </span>
        </div>

        <div className="md:p-4 md:px-4 py-2 flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-2 md:mb-4">
            <h1 className="text-3xl md:text-3xl font-bold">
              {metadata.name} <span className="text-muted-foreground">by</span>{' '}
              {metadata.artist}
              <div className="text-sm text-gray-600 dark:text-gray-400 font-normal">
                Charted by {metadata.charter}
              </div>
            </h1>
            {process.env.NODE_ENV === 'development' && (
              <Button
                variant="outline"
                size="sm"
                className="flex items-center gap-2 px-3 py-1"
                onClick={handleSaveClick}>
                <Star className="h-4 w-4" />
                Save
              </Button>
            )}
          </div>
          <div className="flex flex-1 gap-2 mb-4 overflow-hidden">
            <div
              className={cn(
                viewCloneHero ? 'hidden md:flex' : 'flex',
                'flex-1',
              )}>
              <SheetMusic
                currentTime={currentPlayback}
                chart={chart}
                track={track}
                showBarNumbers={showBarNumbers}
                enableColors={enableColors}
                showLyrics={showLyrics}
                onSelectMeasure={time => {
                  if (audioManagerRef.current == null) {
                    return;
                  }
                  audioManagerRef.current.play({time});

                  setIsPlaying(true);
                }}
                triggerRerender={viewCloneHero}
                practiceModeConfig={practiceMode}
                onPracticeMeasureSelect={handlePracticeMeasureSelect}
                practiceModeStep={practiceModeStep}
                audioManagerRef={audioManagerRef}
              />
            </div>
            {viewCloneHero && (
              <CloneHeroRenderer
                metadata={metadata}
                chart={chart}
                track={track}
                audioManager={audioManagerRef.current!}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface MeasureHighlightProps {
  style?: React.CSSProperties;
  highlighted?: boolean;
  onClick?: () => void;
}

const MeasureHighlight = forwardRef<HTMLButtonElement, MeasureHighlightProps>(
  ({style, highlighted, onClick}, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'absolute z-[-3] rounded-md border-0 bg-transparent cursor-pointer',
          highlighted && 'bg-primary/10 shadow-md z-[-2]',
          'hover:bg-muted hover:shadow-sm hover:z-[-1]',
        )}
        style={style}
        onClick={onClick}
      />
    );
  },
);

MeasureHighlight.displayName = 'MeasureHighlight';

export function AudioVolume({
  name,
  volume,
  onChange,
  isMuted,
  isSoloed,
  onMuteClick,
  onSoloClick,
}: {
  name: string;
  volume: number;
  isMuted: boolean;
  isSoloed: boolean;
  onChange: (value: number) => void;
  onMuteClick: () => void;
  onSoloClick: () => void;
}) {
  return (
    <div key={name} className="space-y-2">
      <label className="text-sm font-medium">{capitalize(name)}</label>
      <div className="flex items-center gap-2">
        <Slider
          defaultValue={[volume]}
          min={0}
          max={1}
          step={0.01}
          className="flex-1"
          onValueChange={values => onChange(values[0])}
        />
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-6 w-6"
            onClick={onMuteClick}>
            {isMuted ? (
              <VolumeX className="h-3 w-3" />
            ) : (
              <Volume2 className="h-3 w-3" />
            )}
          </Button>
          <Button
            variant={isSoloed ? 'secondary' : 'outline'}
            size="icon"
            className="h-6 w-6"
            onClick={onSoloClick}>
            S
          </Button>
        </div>
      </div>
    </div>
  );
}

function ClickDialog({
  open,
  setOpen,
  clickVolumes,
  handleClickVolumeChange,
  masterClickVolume,
  setMasterClickVolume,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  clickVolumes: ClickVolumes;
  handleClickVolumeChange: (value: number, key: keyof ClickVolumes) => void;
  masterClickVolume: number;
  setMasterClickVolume: (value: number) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-center text-xl font-medium">
            Configure Click Track
          </DialogTitle>
          {/* <DialogDescription>
            Configure volume levels for the click track.
          </DialogDescription> */}
        </DialogHeader>

        {/* Mobile layout - stacked with horizontal sliders */}
        <div className="flex flex-col space-y-6 pt-4">
          {/* Master Volume */}
          <ClickVolume
            name="Master"
            volume={masterClickVolume}
            onChange={val => setMasterClickVolume(val)}
          />

          {/* Separator */}
          <div className="h-px w-full bg-border my-2"></div>

          {/* Whole Note */}
          <ClickVolume
            // name="○"
            svg={wholeNote}
            volume={clickVolumes.wholeNote}
            onChange={val => handleClickVolumeChange(val, 'wholeNote')}
          />

          {/* Quarter Note */}
          <ClickVolume
            svg={quarterNote}
            volume={clickVolumes.quarterNote}
            onChange={val => handleClickVolumeChange(val, 'quarterNote')}
          />

          {/* Eighth Note */}
          <ClickVolume
            svg={eighthNote}
            volume={clickVolumes.eighthNote}
            onChange={val => handleClickVolumeChange(val, 'eighthNote')}
          />

          {/* Triplet */}
          <ClickVolume
            svg={tripletNote}
            volume={clickVolumes.tripletNote}
            onChange={val => handleClickVolumeChange(val, 'tripletNote')}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ClickVolume({
  name,
  svg,
  volume,
  onChange,
}: {
  name?: string;
  svg?: any;
  volume: number;
  onChange: (value: number) => void;
}) {
  const description = name ? (
    capitalize(name)
  ) : (
    <Image
      src={svg}
      alt="Whole note"
      className="foreground h-[26px] max-w-[30px]"
    />
  );
  return (
    <div key={name} className="space-y-2">
      <label className="text-sm font-medium">{description}</label>
      <div className="flex items-center gap-2">
        <Slider
          defaultValue={[volume]}
          min={0}
          max={1}
          step={0.01}
          className="flex-1"
          onValueChange={values => onChange(values[0])}
        />
      </div>
    </div>
  );
}
