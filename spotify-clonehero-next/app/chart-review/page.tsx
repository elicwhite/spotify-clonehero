'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {parseChartFile} from '@eliwhite/scan-chart';
import {Loader2} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {Slider} from '@/components/ui/slider';
import {
  readChartDirectory,
  readSngFile,
} from '@/components/chart-picker/chart-file-readers';
import {
  findAudioFiles,
  findChartData,
} from '@/lib/preview/chorus-chart-processing';
import {AudioManager} from '@/lib/preview/audioManager';
import {getChartDelayMs} from '@/lib/chart-utils/chartDelay';
import {readChart} from '@/lib/chart-edit';
import {setupRenderer} from '@/lib/preview/highway';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import {hasIniName} from '@/lib/src-shared/utils';
import scanLocalCharts, {
  type SongAccumulator,
} from '@/lib/local-songs-folder/scanLocalCharts';

type ParsedChart = ReturnType<typeof parseChartFile>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PreparedChart {
  song: SongAccumulator;
  metadata: ChartResponseEncore;
  chart: ParsedChart;
  track: ParsedChart['trackData'][0];
  audioManager: AudioManager;
  /** Chart time (seconds) to seek to for the densest section. */
  seekTimeSec: number;
}

interface Rating {
  name: string;
  rating: 'good' | 'bad';
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRO_DRUMS_MODIFIERS = {
  song_length: 0,
  hopo_frequency: 0,
  eighthnote_hopo: false,
  multiplier_note: 0,
  sustain_cutoff_threshold: -1,
  chord_snap_threshold: 0,
  five_lane_drums: false,
  pro_drums: true,
} as const;

const PRELOAD_COUNT = 3;
const SAVE_INTERVAL_SONGS = 5;
const SAVE_IDLE_MS = 10_000;

// ---------------------------------------------------------------------------
// IndexedDB handle persistence
// ---------------------------------------------------------------------------

const IDB_NAME = 'chart-review';
const IDB_STORE = 'handles';

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function saveHandle(
  key: string,
  handle: FileSystemDirectoryHandle | FileSystemFileHandle,
) {
  openHandleDb().then(db => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, key);
  });
}

async function getStoredHandles(db: IDBDatabase): Promise<{
  chartsDir?: FileSystemDirectoryHandle;
  tsvFile?: FileSystemFileHandle;
}> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const dirReq = store.get('chartsDir');
    const fileReq = store.get('tsvFile');
    tx.oncomplete = () =>
      resolve({chartsDir: dirReq.result, tsvFile: fileReq.result});
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Density calculation
// ---------------------------------------------------------------------------

/**
 * Find the start time (in ms) of the densest 10-second window of notes.
 * Returns chart-relative ms.
 */
function findDensestWindow(
  noteEventGroups: ParsedChart['trackData'][0]['noteEventGroups'],
): number {
  // Flatten all note times
  const times: number[] = [];
  for (const group of noteEventGroups) {
    for (const note of group) {
      times.push(note.msTime);
    }
  }
  if (times.length === 0) return 0;
  times.sort((a, b) => a - b);

  const windowMs = 10_000;
  let bestStart = times[0];
  let bestCount = 0;

  let right = 0;
  for (let left = 0; left < times.length; left++) {
    while (right < times.length && times[right] - times[left] <= windowMs) {
      right++;
    }
    const count = right - left;
    if (count > bestCount) {
      bestCount = count;
      bestStart = times[left];
    }
  }

  return bestStart;
}

// ---------------------------------------------------------------------------
// TSV persistence
// ---------------------------------------------------------------------------

function ratingsToTsv(ratings: Rating[]): string {
  const header = 'name\trating\ttimestamp';
  const rows = ratings.map(r => `${r.name}\t${r.rating}\t${r.timestamp}`);
  return [header, ...rows].join('\n') + '\n';
}

function parseTsv(text: string): Rating[] {
  const lines = text.trim().split('\n');
  if (lines.length <= 1) return []; // header only or empty
  return lines.slice(1).map(line => {
    const [name, rating, timestamp] = line.split('\t');
    return {name, rating: rating as 'good' | 'bad', timestamp};
  });
}

async function readTsvFile(handle: FileSystemFileHandle): Promise<Rating[]> {
  try {
    const file = await handle.getFile();
    const text = await file.text();
    return parseTsv(text);
  } catch {
    return [];
  }
}

async function writeTsvFile(handle: FileSystemFileHandle, ratings: Rating[]) {
  const writable = await handle.createWritable();
  await writable.write(ratingsToTsv(ratings));
  await writable.close();
}

// ---------------------------------------------------------------------------
// Chart preparation
// ---------------------------------------------------------------------------

async function prepareChart(song: SongAccumulator): Promise<PreparedChart> {
  const {parentDir, fileName} = song.handleInfo;
  let loaded;

  // Determine if the entry is a directory or .sng file
  if (fileName.toLowerCase().endsWith('.sng')) {
    const fileHandle = await parentDir.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    loaded = await readSngFile(file);
  } else {
    const dirHandle = await parentDir.getDirectoryHandle(fileName);
    loaded = await readChartDirectory(dirHandle);
  }

  const {files} = loaded;

  // Parse chart
  const {chartData, format} = findChartData(files);

  // Extract delay from song.ini if present
  const iniFile = files.find(f => hasIniName(f.fileName));
  let iniDelay: number | undefined;
  if (iniFile) {
    const iniText = new TextDecoder().decode(iniFile.data);
    const delayMatch = iniText.match(/^\s*delay\s*=\s*(-?\d+)/im);
    if (delayMatch) iniDelay = parseInt(delayMatch[1], 10);
    if (iniDelay === undefined) {
      const offsetMatch = iniText.match(/^\s*chart_offset\s*=\s*(-?[\d.]+)/im);
      if (offsetMatch) iniDelay = Math.round(parseFloat(offsetMatch[1]) * 1000);
    }
  }

  const iniChartModifiers = Object.assign(
    {...PRO_DRUMS_MODIFIERS},
    iniDelay !== undefined ? {delay: iniDelay} : {},
  );

  const chart = parseChartFile(chartData, format, iniChartModifiers);

  // Find expert drums track, fallback to any drums track
  let track = chart.trackData.find(
    t => t.instrument === 'drums' && t.difficulty === 'expert',
  );
  if (!track) {
    track = chart.trackData.find(t => t.instrument === 'drums');
  }
  if (!track) {
    throw new Error(`No drums track found in ${song.song}`);
  }

  // Find densest section
  const densestMs = findDensestWindow(track.noteEventGroups);

  // Get chart delay
  const chartDoc = readChart(files);
  const chartDelayMs = getChartDelayMs(chartDoc.parsedChart.metadata);

  // Create AudioManager
  const audioFiles = findAudioFiles(files);
  if (audioFiles.length === 0) {
    throw new Error(`No audio files in ${song.song}`);
  }

  const audioManager = new AudioManager(audioFiles, () => {});
  await audioManager.ready;
  audioManager.setChartDelay(chartDelayMs / 1000);

  // Convert chart ms to audio seconds for seeking
  const seekTimeSec = densestMs / 1000;

  // Build metadata for renderer
  const metadata: ChartResponseEncore = {
    name: song.song,
    artist: song.artist,
    charter: song.charter,
    md5: '',
    hasVideoBackground: false,
    albumArtMd5: '',
    notesData: {} as any,
    modifiedTime: song.modifiedTime,
    file: '',
  };

  return {song, metadata, chart, track, audioManager, seekTimeSec};
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ChartReviewPage() {
  // Setup state
  const [chartsDir, setChartsDir] = useState<FileSystemDirectoryHandle | null>(
    null,
  );
  const [tsvHandle, setTsvHandle] = useState<FileSystemFileHandle | null>(null);
  const [allEntries, setAllEntries] = useState<SongAccumulator[]>([]);
  const [scanProgress, setScanProgress] = useState(0);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isReady, setIsReady] = useState(false);

  // Classifier scores: fileName → score (0–1), loaded from public TSV
  const [classifierScores, setClassifierScores] = useState<Map<string, number>>(
    new Map(),
  );

  // Focus score: queue is sorted by distance from this value
  const [focusScore, setFocusScore] = useState(0.85);
  // Local display value updates while dragging; focusScore only commits on release
  const [focusDisplay, setFocusDisplay] = useState(0.85);

  useEffect(() => {
    fetch('/classifications_merged.tsv')
      .then(r => r.text())
      .then(text => {
        const lines = text.trim().split('\n').slice(1); // skip header
        const map = new Map<string, number>();
        for (const line of lines) {
          const tab = line.lastIndexOf('\t');
          if (tab === -1) continue;
          const name = line.slice(0, tab).trim();
          const score = parseFloat(line.slice(tab + 1).trim());
          if (!isNaN(score)) map.set(name, score);
        }
        setClassifierScores(map);
      })
      .catch(err => console.warn('Could not load classifier TSV:', err));
  }, []);

  // Current + preloaded charts
  const [prepared, setPrepared] = useState<Map<number, PreparedChart>>(
    new Map(),
  );
  const [failedIndices, setFailedIndices] = useState<Set<number>>(new Set());

  // Stats
  const ratedSet = useMemo(() => new Set(ratings.map(r => r.name)), [ratings]);
  const goodCount = useMemo(
    () => ratings.filter(r => r.rating === 'good').length,
    [ratings],
  );
  const badCount = useMemo(
    () => ratings.filter(r => r.rating === 'bad').length,
    [ratings],
  );

  // Refs for save logic
  const ratingsRef = useRef(ratings);
  ratingsRef.current = ratings;
  const tsvHandleRef = useRef(tsvHandle);
  tsvHandleRef.current = tsvHandle;
  const unsavedCountRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRatingTimeRef = useRef(0);

  // Queue ordered by classifier score distance from 0.5 (most uncertain first),
  // expanding outward in both directions. Songs absent from the classifier go last.
  const [queue, setQueue] = useState<number[]>([]);
  // Current position in queue. Declared before the effect below so the
  // effect's setQueuePos reference is to an already-initialized binding.
  const [queuePos, setQueuePos] = useState(0);
  useEffect(() => {
    if (allEntries.length === 0) return;

    // Collect unrated entries with their classifier scores
    const classified: {idx: number; score: number}[] = [];
    const unclassified: number[] = [];

    for (let i = 0; i < allEntries.length; i++) {
      if (ratedSet.has(allEntries[i].handleInfo.fileName)) continue;
      const score = classifierScores.get(allEntries[i].handleInfo.fileName);
      if (score !== undefined) {
        classified.push({idx: i, score});
      } else {
        unclassified.push(i);
      }
    }

    // Sort by distance from focusScore ascending — closest first.
    // Add tiny jitter to break ties randomly.
    classified.sort(
      (a, b) =>
        Math.abs(a.score - focusScore) +
        (Math.random() - 0.5) * 0.001 -
        (Math.abs(b.score - focusScore) + (Math.random() - 0.5) * 0.001),
    );

    // Shuffle unclassified songs and append after all classified ones
    for (let i = unclassified.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unclassified[i], unclassified[j]] = [unclassified[j], unclassified[i]];
    }

    setQueue([...classified.map(s => s.idx), ...unclassified]);
    setQueuePos(0);
    // Only rebuild when entries, classifier data, or focus score changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEntries, classifierScores, focusScore]);

  // Save function
  const saveRatings = useCallback(async () => {
    const handle = tsvHandleRef.current;
    if (!handle) return;
    try {
      await writeTsvFile(handle, ratingsRef.current);
      unsavedCountRef.current = 0;
    } catch (err) {
      console.error('Failed to save ratings:', err);
    }
  }, []);

  // Schedule idle save
  const scheduleIdleSave = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      if (unsavedCountRef.current > 0) {
        saveRatings();
      }
    }, SAVE_IDLE_MS);
  }, [saveRatings]);

  // ---------------------------------------------------------------------------
  // Persist handles in IndexedDB so pickers restore on reload
  // ---------------------------------------------------------------------------

  useEffect(() => {
    (async () => {
      try {
        const db = await openHandleDb();
        const stored = await getStoredHandles(db);
        // TS 6's built-in FileSystem*Handle types don't include the
        // experimental permission methods; cast through a minimal interface.
        type WithPerm<M extends string> = {
          requestPermission(d: {mode: M}): Promise<PermissionState>;
        };
        if (stored.chartsDir) {
          const perm = await (
            stored.chartsDir as unknown as WithPerm<'read'>
          ).requestPermission({mode: 'read'});
          if (perm === 'granted') setChartsDir(stored.chartsDir);
        }
        if (stored.tsvFile) {
          const perm = await (
            stored.tsvFile as unknown as WithPerm<'readwrite'>
          ).requestPermission({mode: 'readwrite'});
          if (perm === 'granted') setTsvHandle(stored.tsvFile);
        }
      } catch {
        // IndexedDB or permission denied — user will pick manually
      }
    })();
  }, []);

  // ---------------------------------------------------------------------------
  // Setup: pick folder + TSV file
  // ---------------------------------------------------------------------------

  const handlePickFolder = useCallback(async () => {
    try {
      const dirHandle = await window.showDirectoryPicker({
        id: 'chart-review-charts',
        mode: 'read',
      });
      setChartsDir(dirHandle);
      saveHandle('chartsDir', dirHandle);
    } catch {
      // User cancelled
    }
  }, []);

  const handlePickTsvFile = useCallback(async () => {
    try {
      const [handle] = await window.showOpenFilePicker({
        id: 'chart-review-results',
        multiple: false,
        types: [
          {
            description: 'TSV files',
            accept: {'text/tab-separated-values': ['.tsv']},
          },
        ],
      });
      setTsvHandle(handle);
      saveHandle('tsvFile', handle);
    } catch {
      // User cancelled
    }
  }, []);

  // Start scanning once both are picked
  useEffect(() => {
    if (!chartsDir || !tsvHandle) return;

    let cancelled = false;
    (async () => {
      setIsScanning(true);

      // Read existing ratings
      const existingRatings = await readTsvFile(tsvHandle);
      if (cancelled) return;
      setRatings(existingRatings);

      // Scan for charts using scanLocalCharts
      const accumulator: SongAccumulator[] = [];
      await scanLocalCharts(chartsDir, accumulator, () => {
        setScanProgress(accumulator.length);
      });
      if (cancelled) return;
      setAllEntries(accumulator);

      toast.success(
        `Found ${accumulator.length} charts, ${existingRatings.length} already rated`,
      );
      setIsScanning(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [chartsDir, tsvHandle]);

  // ---------------------------------------------------------------------------
  // Preloading
  // ---------------------------------------------------------------------------

  // Preload charts for current queue position and next PRELOAD_COUNT
  useEffect(() => {
    if (queue.length === 0 || queuePos >= queue.length) return;

    let cancelled = false;
    const indicesToLoad: number[] = [];

    for (
      let i = queuePos;
      i < Math.min(queuePos + PRELOAD_COUNT + 1, queue.length);
      i++
    ) {
      const entryIndex = queue[i];
      if (!prepared.has(entryIndex) && !failedIndices.has(entryIndex)) {
        indicesToLoad.push(entryIndex);
      }
    }

    (async () => {
      for (const idx of indicesToLoad) {
        if (cancelled) return;
        try {
          const p = await prepareChart(allEntries[idx]);
          if (cancelled) return;
          setPrepared(prev => new Map(prev).set(idx, p));
        } catch (err) {
          console.warn(`Failed to load ${allEntries[idx].song}:`, err);
          if (!cancelled) {
            setFailedIndices(prev => new Set(prev).add(idx));
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [queue, queuePos, allEntries, prepared, failedIndices]);

  // Derive current and next prepared charts from queue + prepared map
  const currentEntryIndex = queuePos < queue.length ? queue[queuePos] : -1;
  const nextEntryIndex = queuePos + 1 < queue.length ? queue[queuePos + 1] : -1;

  const currentChart =
    currentEntryIndex >= 0 ? (prepared.get(currentEntryIndex) ?? null) : null;
  const nextChart =
    nextEntryIndex >= 0 ? (prepared.get(nextEntryIndex) ?? null) : null;

  // Stop and destroy audio for any prepared chart no longer in the active window
  useEffect(() => {
    if (queue.length === 0) return;
    const relevant = new Set(
      queue.slice(queuePos, queuePos + PRELOAD_COUNT + 1),
    );
    setPrepared(prev => {
      const stale = Array.from(prev.keys()).filter(k => !relevant.has(k));
      if (stale.length === 0) return prev;
      const next = new Map(prev);
      for (const k of stale) {
        next.get(k)?.audioManager.destroy();
        next.delete(k);
      }
      return next;
    });
  }, [queuePos, queue]);

  // Skip failed entries
  useEffect(() => {
    if (currentEntryIndex >= 0 && failedIndices.has(currentEntryIndex)) {
      setQueuePos(prev => prev + 1);
    }
  }, [currentEntryIndex, failedIndices]);

  // Mark ready once first chart is loaded
  useEffect(() => {
    if (currentChart && !isReady) {
      setIsReady(true);
    }
  }, [currentChart, isReady]);

  // Auto-play current chart when it becomes active
  const lastPlayedRef = useRef<string | null>(null);
  const playCurrentChart = useCallback(() => {
    if (!currentChart) return;
    const key = currentChart.song.handleInfo.fileName;
    if (lastPlayedRef.current === key) return;
    currentChart.audioManager
      .playChartTime(currentChart.seekTimeSec)
      .then(() => {
        lastPlayedRef.current = key;
      })
      .catch(err => {
        console.warn('Auto-play failed (will retry on interaction):', err);
      });
  }, [currentChart]);

  useEffect(() => {
    playCurrentChart();
  }, [playCurrentChart]);

  // Retry auto-play on any user interaction (AudioContext needs a gesture)
  useEffect(() => {
    const retry = () => playCurrentChart();
    window.addEventListener('keydown', retry);
    window.addEventListener('click', retry);
    return () => {
      window.removeEventListener('keydown', retry);
      window.removeEventListener('click', retry);
    };
  }, [playCurrentChart]);

  // ---------------------------------------------------------------------------
  // Rating handler
  // ---------------------------------------------------------------------------

  const handleRate = useCallback(
    (rating: 'good' | 'bad') => {
      if (!currentChart) return;

      // Stop current audio
      currentChart.audioManager.stop();

      // Add rating
      const newRating: Rating = {
        name: currentChart.song.handleInfo.fileName,
        rating,
        timestamp: new Date().toISOString(),
      };
      setRatings(prev => [...prev, newRating]);
      unsavedCountRef.current++;
      lastRatingTimeRef.current = Date.now();

      // Clean up: destroy the current chart and any older ones, but keep next+
      const curIdx = queue[queuePos];
      setPrepared(prev => {
        const next = new Map(prev);
        Array.from(next.keys()).forEach(key => {
          if (key <= curIdx) {
            next.get(key)?.audioManager.destroy();
            next.delete(key);
          }
        });
        return next;
      });

      // Move to next (its renderer is already mounted)
      setQueuePos(prev => prev + 1);

      // Start playing the next chart immediately (while we're still in the
      // user gesture context so AudioContext.resume() is allowed)
      if (nextChart) {
        lastPlayedRef.current = nextChart.song.handleInfo.fileName;
        nextChart.audioManager
          .playChartTime(nextChart.seekTimeSec)
          .catch(() => {});
      }

      // Save if threshold reached
      if (unsavedCountRef.current >= SAVE_INTERVAL_SONGS) {
        saveRatings();
      } else {
        scheduleIdleSave();
      }
    },
    [currentChart, nextChart, queue, queuePos, saveRatings, scheduleIdleSave],
  );

  // Rate ALL songs by the current artist across the entire library
  const handleRateArtist = useCallback(
    (rating: 'good' | 'bad') => {
      if (!currentChart) return;
      const artist = currentChart.metadata.artist;
      const charter = currentChart.metadata.charter;
      if (!artist || !charter) return;

      // Stop current audio
      currentChart.audioManager.stop();

      // Find every entry by this artist+charter combo and rate them all
      const now = new Date().toISOString();
      const newRatings: Rating[] = [];
      const bulkRatedSet = new Set<string>();

      for (const entry of allEntries) {
        if (
          entry.artist === artist &&
          entry.charter === charter &&
          !ratedSet.has(entry.handleInfo.fileName)
        ) {
          newRatings.push({
            name: entry.handleInfo.fileName,
            rating,
            timestamp: now,
          });
          bulkRatedSet.add(entry.handleInfo.fileName);
        }
      }

      setRatings(prev => [...prev, ...newRatings]);
      unsavedCountRef.current += newRatings.length;
      lastRatingTimeRef.current = Date.now();

      toast.success(
        `Rated ${newRatings.length} song(s) by "${artist}" (charter: ${charter}) as ${rating}`,
      );

      // Destroy any prepared charts that were just rated
      setPrepared(prev => {
        const next = new Map(prev);
        Array.from(next.keys()).forEach(key => {
          const p = next.get(key);
          if (p && bulkRatedSet.has(p.song.handleInfo.fileName)) {
            p.audioManager.destroy();
            next.delete(key);
          }
        });
        return next;
      });

      // Skip forward past any now-rated songs in the queue
      let nextPos = queuePos + 1;
      while (
        nextPos < queue.length &&
        bulkRatedSet.has(allEntries[queue[nextPos]].handleInfo.fileName)
      ) {
        nextPos++;
      }
      setQueuePos(nextPos);

      // Force save since this can be a large batch
      saveRatings();
    },
    [currentChart, allEntries, ratedSet, queue, queuePos, saveRatings],
  );

  // Skip without rating
  const handleSkip = useCallback(() => {
    if (!currentChart) return;
    currentChart.audioManager.stop();

    const curIdx = queue[queuePos];
    setPrepared(prev => {
      const next = new Map(prev);
      Array.from(next.keys()).forEach(key => {
        if (key <= curIdx) {
          next.get(key)?.audioManager.destroy();
          next.delete(key);
        }
      });
      return next;
    });

    setQueuePos(prev => prev + 1);

    if (nextChart) {
      lastPlayedRef.current = nextChart.song.handleInfo.fileName;
      nextChart.audioManager
        .playChartTime(nextChart.seekTimeSec)
        .catch(() => {});
    }
  }, [currentChart, nextChart, queue, queuePos]);

  // Ref for current chart (used by seek handler to avoid stale closures)
  const currentChartRef = useRef(currentChart);
  currentChartRef.current = currentChart;

  // Keyboard handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleRate('good');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleRate('bad');
      } else if (e.key === 'x') {
        e.preventDefault();
        handleSkip();
      } else if (e.key === 'a') {
        e.preventDefault();
        handleRateArtist('bad');
      } else if (e.key === 's') {
        e.preventDefault();
        handleRateArtist('good');
      } else if (e.key === ' ') {
        e.preventDefault();
        const p = currentChartRef.current;
        if (!p) return;
        if (p.audioManager.isPlaying) {
          p.audioManager.pause();
        } else {
          p.audioManager.resume();
        }
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const p = currentChartRef.current;
        if (!p) return;
        const am = p.audioManager;
        const current = am.currentTime;
        const delta = e.key === 'ArrowUp' ? 10 : -10;
        const target = Math.max(0, Math.min(current + delta, am.duration));
        am.play({time: target});
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleRate, handleRateArtist, handleSkip]);

  // Save on unmount
  useEffect(() => {
    return () => {
      if (unsavedCountRef.current > 0) {
        // Best-effort save
        saveRatings();
      }
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [saveRatings]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Setup screen
  if (!chartsDir || !tsvHandle) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col gap-4 items-center max-w-md text-center">
          <h1 className="text-2xl font-bold">Chart Review</h1>
          <p className="text-muted-foreground text-sm">
            Rate drum charts as good/bad. Right arrow = good, left arrow = bad.
          </p>
          <div className="flex flex-col gap-3 w-full">
            <Button
              onClick={handlePickFolder}
              variant={chartsDir ? 'outline' : 'default'}
              className="w-full">
              {chartsDir ? `Folder: ${chartsDir.name}` : 'Pick Charts Folder'}
            </Button>
            <Button
              onClick={handlePickTsvFile}
              variant={tsvHandle ? 'outline' : 'default'}
              className="w-full"
              disabled={!chartsDir}>
              {tsvHandle ? 'Results file selected' : 'Pick Results File (.tsv)'}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  // Scanning
  if (isScanning) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-muted-foreground">
            Scanning charts folder...{' '}
            {scanProgress > 0 && `(${scanProgress} found)`}
          </span>
        </div>
      </main>
    );
  }

  // All done
  if (queuePos >= queue.length && allEntries.length > 0) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold mb-2">All done!</h2>
          <p className="text-muted-foreground">
            Rated {ratings.length} / {allEntries.length} charts.
            {goodCount} good, {badCount} bad.
          </p>
        </div>
      </main>
    );
  }

  // Loading current chart
  if (!currentChart) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-muted-foreground">
            Loading chart {queuePos + 1} of {queue.length}...
          </span>
        </div>
      </main>
    );
  }

  // Review UI
  return (
    <main className="h-screen w-screen flex flex-col bg-background">
      {/* Focus slider */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-card text-sm">
        <span className="text-muted-foreground shrink-0">Focus</span>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[focusDisplay]}
          onValueChange={([v]) => setFocusDisplay(v)}
          onValueCommit={([v]) => {
            setFocusDisplay(v);
            setFocusScore(v);
          }}
          className="w-48"
        />
        <span className="font-mono text-xs w-10">
          {focusDisplay.toFixed(2)}
        </span>
      </div>

      {/* Stats bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-card text-sm">
        <div className="flex items-center gap-4">
          <span className="font-medium truncate max-w-md">
            {currentChart.metadata.artist
              ? `${currentChart.metadata.artist} — ${currentChart.metadata.name}`
              : currentChart.metadata.name}
          </span>
          {currentChart.metadata.charter && (
            <span className="text-muted-foreground">
              by {currentChart.metadata.charter}
            </span>
          )}
          {currentChart.song.genre && (
            <span className="text-muted-foreground italic">
              {currentChart.song.genre}
            </span>
          )}
          {(() => {
            const s = classifierScores.get(
              currentChart.song.handleInfo.fileName,
            );
            return s !== undefined ? (
              <span
                className="font-mono text-xs px-1.5 py-0.5 rounded"
                style={{
                  background: `hsl(${Math.round(s * 120)}, 60%, 35%)`,
                  color: 'white',
                }}>
                {s.toFixed(3)}
              </span>
            ) : null;
          })()}
        </div>
        <div className="flex items-center gap-4 text-muted-foreground">
          <span>
            {queuePos + 1} / {queue.length} remaining
          </span>
          <span className="text-green-600">{goodCount} good</span>
          <span className="text-red-600">{badCount} bad</span>
          <span>
            {ratings.length} / {allEntries.length} total
          </span>
        </div>
      </div>

      {/* Highway renderers: current on top, next pre-rendered behind */}
      <div className="flex-1 min-h-0 relative">
        {/* Next chart (hidden, pre-rendering) */}
        {nextChart && (
          <div
            key={nextChart.song.handleInfo.fileName}
            className="absolute inset-0 flex flex-col"
            style={{visibility: 'hidden'}}>
            <ChartPreview prepared={nextChart} active={false} />
          </div>
        )}
        {/* Current chart (visible) */}
        <div
          key={currentChart.song.handleInfo.fileName}
          className="absolute inset-0 flex flex-col">
          <ChartPreview prepared={currentChart} active={true} />
        </div>
      </div>

      {/* Controls hint */}
      <div className="flex items-center justify-center gap-8 px-4 py-2 border-t bg-card text-sm text-muted-foreground">
        <span>← Bad</span>
        <span>→ Good</span>
        <span>X: Skip</span>
        <span className="border-l pl-8">A: Charter+artist bad</span>
        <span>S: Charter+artist good</span>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Chart preview that separates prep (textures, notes) from render loop.
// When active=false, the scene is prepared but the animation loop doesn't run,
// avoiding WebGL context thrashing and the "null shader" spam.
// ---------------------------------------------------------------------------

function ChartPreview({
  prepared,
  active,
}: {
  prepared: PreparedChart;
  active: boolean;
}) {
  const sizingRef = useRef<HTMLDivElement>(null!);
  const canvasRef = useRef<HTMLDivElement>(null!);
  const rendererRef = useRef<ReturnType<typeof setupRenderer> | null>(null);
  const renderingRef = useRef(false);

  // Create renderer + prep track on mount
  useEffect(() => {
    const renderer = setupRenderer(
      prepared.metadata,
      prepared.chart,
      sizingRef,
      canvasRef,
      prepared.audioManager,
    );
    rendererRef.current = renderer;
    renderer.prepTrack(prepared.track);
    return () => {
      renderer.destroy();
      rendererRef.current = null;
      renderingRef.current = false;
    };
  }, [prepared]);

  // Only start the render loop when active
  useEffect(() => {
    if (active && rendererRef.current && !renderingRef.current) {
      renderingRef.current = true;
      rendererRef.current.startRender();
    }
  }, [active]);

  return (
    <div className="flex-1 flex-col justify-center bg-white rounded-lg border overflow-y-auto">
      <div className="relative h-full" ref={sizingRef}>
        <div ref={canvasRef} className="h-full" />
      </div>
    </div>
  );
}
