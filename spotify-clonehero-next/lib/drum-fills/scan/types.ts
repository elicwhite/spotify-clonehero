/**
 * Shared message + result types for the library-scan pipeline (worker +
 * controller). Everything here must be structured-cloneable so it can cross the
 * worker boundary via postMessage.
 */

import type {Subdivision} from '@/lib/drum-fills/db';
import type {FillFeatures} from '@/lib/drum-fills/detection/types';

/** Per-song metadata captured during the scan, attached to each detected fill. */
export interface ScannedSongMeta {
  /** Stable hash identifying this chart (Expert-drums track hash). */
  chartHash: string;
  /** Human-readable library location (parentDir/fileName). */
  libraryPath: string;
  song: string;
  artist: string;
  charter: string;
}

/**
 * A fully-classified fill ready to persist. This is the serializable shape the
 * worker posts to the controller; it maps almost 1:1 onto the DB `FillInput`.
 */
export interface ScannedFill {
  /** Stable id derived from chartHash + fingerprint + ordinal. */
  id: string;
  chartHash: string;
  libraryPath: string;
  song: string;
  artist: string;
  charter: string;
  startTick: number;
  endTick: number;
  grooveStartTick: number;
  grooveEndTick: number;
  tempoBpm: number;
  lengthBars: number;
  subdivision: Subdivision;
  complexity: number;
  voicingTags: string[];
  /** Continuous difficulty in [0, 100] for ladder ordering. */
  difficultyScore: number;
  fingerprint: string;
  /** Canonical fingerprint of the fill's preceding-groove span (exact match). */
  grooveFingerprint: string;
  /** Groove fingerprint with cymbal collapsed + coarse grid, for clustering. */
  grooveSimilarityKey: string;
  /** Cross-song fill similarity key (dynamics stripped) for library dedupe. */
  fillSimilarityKey: string;
  confidence: number;
  features: FillFeatures;
}

/** Progress snapshot emitted continuously during a scan. */
export interface ScanProgress {
  songsScanned: number;
  /** Best-effort estimate of total songs (enumerated count); may grow. */
  totalEstimate: number;
  fillsFound: number;
  /** Display name of the song currently being processed, if any. */
  currentSong: string | null;
  /** Songs that failed to read/parse/detect and were skipped. */
  errors: number;
}

// --- Worker protocol --------------------------------------------------------

/** Main → Worker: kick off a scan of the given directory handle. */
export interface ScanStartMessage {
  type: 'start';
  directoryHandle: FileSystemDirectoryHandle;
}

/** Main → Worker: request cancellation of the in-flight scan. */
export interface ScanCancelMessage {
  type: 'cancel';
}

export type ScanRequest = ScanStartMessage | ScanCancelMessage;

/** Worker → Main: periodic progress update. */
export interface ScanProgressMessage {
  type: 'progress';
  progress: ScanProgress;
}

/** Worker → Main: a batch of detected fills for one or more songs. */
export interface ScanResultsMessage {
  type: 'results';
  fills: ScannedFill[];
}

/** Worker → Main: the scan finished (or was cancelled). */
export interface ScanDoneMessage {
  type: 'done';
  cancelled: boolean;
  progress: ScanProgress;
}

/** Worker → Main: a fatal error aborted the whole scan. */
export interface ScanErrorMessage {
  type: 'error';
  message: string;
}

export type ScanResponse =
  | ScanProgressMessage
  | ScanResultsMessage
  | ScanDoneMessage
  | ScanErrorMessage;
