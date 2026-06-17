'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {defaultIniChartModifiers, parseChartFile} from '@eliwhite/scan-chart';
import {Play, Pause, Loader2} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {Slider} from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {cn} from '@/lib/utils';
import {
  Files,
  ParsedChart,
  findAudioFiles,
} from '@/lib/preview/chorus-chart-processing';
import {AudioManager} from '@/lib/preview/audioManager';
import {getChartDelayMs} from '@/lib/chart-utils/chartDelay';
import {hasIniName} from '@/lib/src-shared/utils';
import type {ChartResponseEncore} from '@/lib/chartSelection';

import SheetMusic from '@/app/sheet-music/[slug]/SheetMusic';
import CloneHeroRenderer from '@/app/sheet-music/[slug]/CloneHeroRenderer';

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type Variant = 'original' | 'modified';

interface SongPair {
  id: string;
  label: string;
  modifiedFolder: string;
  originalFolder: string;
}

interface VariantData {
  files: Files;
  chart: ParsedChart;
}

interface LoadedSong {
  pair: SongPair;
  original: VariantData;
  modified: VariantData;
}

const PRO_DRUMS_MODIFIERS = {
  ...defaultIniChartModifiers,
  pro_drums: true,
} as const;

async function fetchListing(folder: string): Promise<string[]> {
  const res = await fetch(
    `/api/tempo-spotcheck?folder=${encodeURIComponent(folder)}`,
  );
  if (!res.ok) throw new Error(`Listing failed for ${folder}`);
  const json = await res.json();
  return json.files as string[];
}

async function fetchFile(folder: string, file: string): Promise<Uint8Array> {
  const res = await fetch(
    `/api/tempo-spotcheck/file?folder=${encodeURIComponent(folder)}&file=${encodeURIComponent(file)}`,
  );
  if (!res.ok) throw new Error(`Fetch failed for ${folder}/${file}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

/** File names we'll request from each variant's folder. */
const KNOWN_FILES = [
  'notes.mid',
  'notes.chart',
  'song.ini',
  'guitar.opus',
  'rhythm.opus',
  'bass.opus',
  'keys.opus',
  'vocals.opus',
  'vocals_1.opus',
  'vocals_2.opus',
  'drums.opus',
  'drums_1.opus',
  'drums_2.opus',
  'drums_3.opus',
  'drums_4.opus',
  'song.opus',
];

async function fetchVariantFiles(folder: string): Promise<Files> {
  const listing = await fetchListing(folder);
  const wanted = KNOWN_FILES.filter(f => listing.includes(f));
  const files: Files = await Promise.all(
    wanted.map(async file => ({
      fileName: file,
      data: await fetchFile(folder, file),
    })),
  );
  return files;
}

function findChartFile(files: Files): {
  data: Uint8Array;
  format: 'mid' | 'chart';
} {
  const mid = files.find(f => f.fileName === 'notes.mid');
  if (mid) return {data: mid.data, format: 'mid'};
  const chart = files.find(f => f.fileName === 'notes.chart');
  if (chart) return {data: chart.data, format: 'chart'};
  throw new Error('No chart file found in variant');
}

function parseVariantChart(files: Files): ParsedChart {
  const {data, format} = findChartFile(files);

  let iniDelay: number | undefined;
  const iniFile = files.find(f => hasIniName(f.fileName));
  if (iniFile) {
    const iniText = new TextDecoder().decode(iniFile.data);
    const delayMatch = iniText.match(/^\s*delay\s*=\s*(-?\d+)/im);
    if (delayMatch) iniDelay = parseInt(delayMatch[1], 10);
    if (iniDelay === undefined) {
      const offsetMatch = iniText.match(/^\s*chart_offset\s*=\s*(-?[\d.]+)/im);
      if (offsetMatch) iniDelay = Math.round(parseFloat(offsetMatch[1]) * 1000);
    }
  }

  const modifiers = {
    ...PRO_DRUMS_MODIFIERS,
    ...(iniDelay !== undefined ? {delay: iniDelay} : {}),
  };
  return parseChartFile(data, format, modifiers);
}

function buildMetadata(
  pair: SongPair,
  chart: ParsedChart,
): ChartResponseEncore {
  return {
    name: pair.label,
    artist: '',
    charter: '',
    md5: pair.id,
    hasVideoBackground: false,
    albumArtMd5: '',
    notesData: {} as any,
    modifiedTime: '',
    file: '',
    song_length: Math.max(
      0,
      ...chart.trackData
        .flatMap(t => t.noteEventGroups.flat())
        .map(n => n.msTime + (n.msLength || 0)),
    ),
  } as ChartResponseEncore;
}

interface TempoTsEntry {
  tick: number;
  msTime: number;
  kind: 'tempo' | 'ts';
  /** For tempo: BPM. For TS: "n/d". */
  label: string;
}

function buildEventList(chart: ParsedChart): TempoTsEntry[] {
  const entries: TempoTsEntry[] = [];
  for (const t of chart.tempos) {
    entries.push({
      tick: t.tick,
      msTime: t.msTime,
      kind: 'tempo',
      label: `${t.beatsPerMinute.toFixed(2)} BPM`,
    });
  }
  for (const ts of chart.timeSignatures) {
    entries.push({
      tick: ts.tick,
      msTime: ts.msTime,
      kind: 'ts',
      label: `${ts.numerator}/${ts.denominator}`,
    });
  }
  entries.sort((a, b) => a.tick - b.tick || (a.kind === 'ts' ? -1 : 1));
  return entries;
}

function formatTimeMs(ms: number): string {
  if (!isFinite(ms)) return '0:00';
  const total = Math.max(0, ms);
  const mins = Math.floor(total / 60000);
  const secs = Math.floor((total % 60000) / 1000);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TempoViewerClient() {
  const [pairs, setPairs] = useState<SongPair[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [loaded, setLoaded] = useState<LoadedSong | null>(null);
  const [variant, setVariant] = useState<Variant>('modified');

  // Loading is derived: a selection is loading while neither the loaded song
  // nor an error is tagged with the current selectedId. This avoids flipping a
  // loading flag synchronously inside the load effect.
  const loading =
    selectedId != null &&
    loaded?.pair.id !== selectedId &&
    loadError?.id !== selectedId;
  const error =
    listError ?? (loadError?.id === selectedId ? loadError.message : null);

  const [audioManager, setAudioManager] = useState<AudioManager | null>(null);
  const audioManagerRef = useRef<AudioManager | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // ---------- fetch song list once ----------
  useEffect(() => {
    fetch('/api/tempo-spotcheck')
      .then(r => r.json())
      .then(json => {
        if (json.error) throw new Error(json.error);
        setPairs(json.pairs as SongPair[]);
        if (json.pairs.length > 0) setSelectedId(json.pairs[0].id);
      })
      .catch(err => setListError(err.message ?? String(err)));
  }, []);

  // ---------- load selected song ----------
  useEffect(() => {
    if (!selectedId || !pairs) return;
    const pair = pairs.find(p => p.id === selectedId);
    if (!pair) return;

    let cancelled = false;

    (async () => {
      try {
        const [originalFiles, modifiedFiles] = await Promise.all([
          fetchVariantFiles(pair.originalFolder),
          fetchVariantFiles(pair.modifiedFolder),
        ]);
        if (cancelled) return;
        const originalChart = parseVariantChart(originalFiles);
        const modifiedChart = parseVariantChart(modifiedFiles);
        setLoaded({
          pair,
          original: {files: originalFiles, chart: originalChart},
          modified: {files: modifiedFiles, chart: modifiedChart},
        });
      } catch (err) {
        if (!cancelled)
          setLoadError({
            id: pair.id,
            message: (err as Error).message ?? String(err),
          });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId, pairs]);

  // ---------- audio manager (per song; same audio for both variants) ----------
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const audioFiles = findAudioFiles(loaded.modified.files);
    if (audioFiles.length === 0) return;

    const manager = new AudioManager(audioFiles, () => {
      setIsPlaying(false);
    });

    manager.ready.then(() => {
      if (cancelled) {
        manager.destroy();
        return;
      }
      const delayMs = getChartDelayMs(loaded.modified.chart.metadata);
      manager.setChartDelay(delayMs / 1000);
      audioManagerRef.current = manager;
      setAudioManager(manager);
    });

    return () => {
      cancelled = true;
      manager.destroy();
      if (audioManagerRef.current === manager) {
        audioManagerRef.current = null;
        setAudioManager(null);
      }
    };
  }, [loaded]);

  // poll currentTime while playing
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      if (audioManagerRef.current) {
        setCurrentTime(audioManagerRef.current.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  // ---------- current variant chart ----------
  const currentVariant = loaded
    ? variant === 'original'
      ? loaded.original
      : loaded.modified
    : null;

  const currentChart = currentVariant?.chart ?? null;
  const currentTrack = useMemo(() => {
    if (!currentChart) return null;
    const expert = currentChart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    if (expert) return expert;
    return currentChart.trackData.find(t => t.instrument === 'drums') ?? null;
  }, [currentChart]);

  const metadata = useMemo(
    () =>
      loaded && currentChart ? buildMetadata(loaded.pair, currentChart) : null,
    [loaded, currentChart],
  );

  // ---------- tempo/TS list for current variant ----------
  const eventList = useMemo(
    () => (currentChart ? buildEventList(currentChart) : []),
    [currentChart],
  );

  // ---------- chart lyrics (sheet music expects this prop) ----------
  const lyrics = useMemo(
    () =>
      currentChart?.vocalTracks.parts['vocals']?.notePhrases.flatMap(
        p => p.lyrics,
      ) ?? [],
    [currentChart],
  );

  // ---------- seek to event ----------
  const seekToTick = useCallback(
    (entry: TempoTsEntry) => {
      const am = audioManagerRef.current;
      if (!am) return;
      // Convert ms to seconds; clamp to >= 0
      const sec = Math.max(0, entry.msTime / 1000);
      if (isPlaying) {
        am.playChartTime(sec);
      } else {
        am.seekToChartTime(sec);
      }
      setCurrentTime(am.currentTime);
    },
    [isPlaying],
  );

  const handlePlay = () => {
    const am = audioManagerRef.current;
    if (!am) return;
    if (isPlaying) {
      am.pause();
      setIsPlaying(false);
    } else if (!am.isInitialized) {
      am.play({time: 0});
      setIsPlaying(true);
    } else {
      am.resume();
      setIsPlaying(true);
    }
  };

  // ---------- render ----------
  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-red-600 max-w-xl text-center">{error}</div>
      </main>
    );
  }

  if (!pairs) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </main>
    );
  }

  return (
    <main className="h-screen w-screen flex flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-card">
        <span className="text-sm font-medium shrink-0">Song</span>
        <Select
          value={selectedId ?? undefined}
          onValueChange={v => setSelectedId(v)}>
          <SelectTrigger className="max-w-xl">
            <SelectValue placeholder="Pick a song" />
          </SelectTrigger>
          <SelectContent>
            {pairs.map(p => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2 ml-4">
          <Button
            variant={variant === 'original' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setVariant('original')}>
            Original
          </Button>
          <Button
            variant={variant === 'modified' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setVariant('modified')}>
            Modified
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <Button
            size="icon"
            variant="secondary"
            className="rounded-full"
            disabled={!audioManager}
            onClick={handlePlay}>
            {isPlaying ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5" />
            )}
          </Button>
          <span className="text-xs font-mono text-muted-foreground">
            {formatTimeMs(currentTime * 1000)}
          </span>
        </div>
      </div>

      {/* Seek bar */}
      {audioManager && (
        <div className="px-4 py-2 border-b">
          <Slider
            value={[currentTime]}
            min={0}
            max={audioManager.duration || 1}
            step={0.01}
            onValueChange={vals => {
              const t = vals[0];
              setCurrentTime(t);
              audioManager.play({time: t});
              setIsPlaying(true);
            }}
          />
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        {/* Left: event list */}
        <aside className="w-72 border-r flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b text-sm font-medium bg-muted/30">
            Tempo & Time Signature ({eventList.length})
          </div>
          <div className="flex-1 overflow-y-auto text-sm">
            {eventList.map((e, idx) => (
              <button
                key={`${e.tick}-${e.kind}-${idx}`}
                onClick={() => seekToTick(e)}
                className={cn(
                  'w-full text-left px-3 py-1.5 border-b hover:bg-accent flex items-center gap-2 cursor-pointer',
                  e.kind === 'tempo'
                    ? 'text-purple-700 dark:text-purple-300'
                    : 'text-red-700 dark:text-red-300',
                )}>
                <span className="font-mono text-xs w-12 text-muted-foreground shrink-0">
                  {formatTimeMs(e.msTime)}
                </span>
                <span className="font-mono text-xs w-16 text-muted-foreground shrink-0">
                  t{e.tick}
                </span>
                <span className="text-xs uppercase tracking-wide w-12 shrink-0">
                  {e.kind === 'tempo' ? 'BPM' : 'TS'}
                </span>
                <span className="font-medium truncate">{e.label}</span>
              </button>
            ))}
            {eventList.length === 0 && !loading && (
              <div className="px-3 py-3 text-muted-foreground text-xs">
                No tempo or time-signature events.
              </div>
            )}
          </div>
        </aside>

        {/* Right: sheet music + clone hero */}
        <section className="flex-1 min-w-0 flex">
          {loading || !loaded || !currentChart || !currentTrack || !metadata ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <>
              <div className="flex-1 min-w-0 flex p-2">
                <SheetMusic
                  chart={currentChart}
                  track={currentTrack}
                  showBarNumbers={true}
                  enableColors={true}
                  showLyrics={true}
                  lyrics={lyrics}
                  zoom={1}
                  onSelectMeasure={time => {
                    const am = audioManagerRef.current;
                    if (!am) return;
                    am.playChartTime(time);
                    setIsPlaying(true);
                  }}
                  triggerRerender={`${variant}-${loaded.pair.id}`}
                  practiceModeConfig={null}
                  onPracticeMeasureSelect={() => {}}
                  selectionIndex={null}
                  getChartTimeSec={() => audioManagerRef.current?.chartTime}
                />
              </div>
              {audioManager && (
                <div className="flex-1 min-w-0 flex p-2">
                  <CloneHeroRenderer
                    key={variant}
                    metadata={metadata}
                    chart={currentChart}
                    track={currentTrack}
                    audioManager={audioManager}
                  />
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
