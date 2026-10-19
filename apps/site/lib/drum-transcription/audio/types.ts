/**
 * Audio metadata types for the drum transcription pipeline.
 *
 * Captures information about uploaded/decoded audio for display in the UI
 * and for downstream processing decisions.
 */

/** Metadata about an audio file after it has been decoded. */
export interface AudioMetadata {
  /** Display name derived from the file name (extension stripped). */
  name: string;
  /** Original file name as provided by the user (e.g. "my_song.mp3"). */
  originalFileName: string;
  /** Duration of the audio in milliseconds. */
  durationMs: number;
  /** Sample rate of the original file before resampling. */
  originalSampleRate: number;
  /** Size of the original file in bytes. */
  fileSizeBytes: number;
}

/** Target sample rate for all decoded audio (Demucs native rate). */
export const TARGET_SAMPLE_RATE = 44100;

/** Target channel count for all decoded audio. */
export const TARGET_CHANNELS = 2;

/**
 * Extracts a display name from a file name by removing the extension.
 * E.g. "my_song.mp3" -> "my_song"
 */
export function fileNameToDisplayName(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0) return fileName;
  return fileName.slice(0, lastDot);
}

/**
 * Creates an AudioMetadata object from a File and decoded AudioBuffer.
 */
export function createAudioMetadata(
  file: File,
  decodedBuffer: AudioBuffer,
): AudioMetadata {
  return {
    name: fileNameToDisplayName(file.name),
    originalFileName: file.name,
    durationMs: decodedBuffer.duration * 1000,
    originalSampleRate: decodedBuffer.sampleRate,
    fileSizeBytes: file.size,
  };
}

/**
 * Formats a duration in milliseconds to a human-readable string.
 * E.g. 125400 -> "2:05"
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Formats a file size in bytes to a human-readable string.
 * E.g. 2067853 -> "2.0 MB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
