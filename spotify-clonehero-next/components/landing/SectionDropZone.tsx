'use client';

/**
 * Makes a whole "start a song" section a drop target, so a user never has to
 * click into a sub-mode before they can drag something in. It wraps whatever
 * the section is currently showing (the two-button chooser, or the audio /
 * chart sub-screen) and routes a dropped payload to the flow it belongs to:
 *
 *   chart folder / .zip / .sng -> `onChartLoaded`
 *   audio file                 -> `onAudioFile`
 *   anything else              -> a toast, and nothing else happens
 *
 * `readDroppedChart` does the reading and the telling apart; this decides
 * where each answer goes.
 *
 * The sub-screens have their own drop zones (AudioUploader, ChartDropZone) and
 * those keep their own behaviour — including their own "that isn't an audio
 * file" errors. They mark themselves with `data-nested-dropzone`, and every
 * handler here bails out when the drag is over one of them, so a drop is only
 * ever handled once.
 */

import {useCallback, useState} from 'react';
import {toast} from 'sonner';

import {cn} from '@/lib/utils';
import {
  readDroppedChart,
  type LoadedFiles,
} from '@/lib/chart-files/chart-package';

const UNRECOGNIZED_MESSAGE =
  'Drop an audio file, a chart folder, a .zip, or a .sng';

/** The rejection for a section that only takes charts (no `onAudioFile`). */
const CHART_ONLY_MESSAGE = 'Drop a chart folder, a .zip, or a .sng';

/** Same test AudioUploader applies to a picked file. */
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|flac|aac|m4a|webm|opus|wma)$/i;

function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.test(file.name);
}

/**
 * True when the drag is over a drop zone nested inside this section, which
 * handles its own drops. Marked with `data-nested-dropzone` rather than
 * inferred from `stopPropagation` so both the highlight and the drop routing
 * can ask the same question at any point in the drag.
 */
function isOverNestedZone(e: React.DragEvent): boolean {
  const target = e.target;
  return (
    target instanceof Element &&
    target.closest('[data-nested-dropzone]') !== null
  );
}

export interface SectionDropZoneProps {
  /** Called with a dropped audio file, as if it came from AudioUploader.
   *  Omit on a section whose tool only takes charts: a dropped audio file
   *  then gets the chart-only rejection toast. */
  onAudioFile?: ((file: File) => void) | undefined;
  /** Called with a dropped chart package (folder, .zip or .sng). */
  onChartLoaded: (loaded: LoadedFiles) => void;
  /** Ignore drops entirely, e.g. while a pipeline is already running. */
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}

export default function SectionDropZone({
  onAudioFile,
  onChartLoaded,
  disabled,
  children,
  className,
}: SectionDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const inert = Boolean(disabled) || isReading;

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (isOverNestedZone(e)) return;
      e.preventDefault();
      setIsDragging(false);
      if (inert) return;

      // Called before the await below: `dataTransfer` is emptied as soon as
      // this handler returns.
      const dropped = readDroppedChart(e.dataTransfer);

      void (async () => {
        setIsReading(true);
        try {
          const result = await dropped;
          if (result.kind === 'chart') {
            onChartLoaded(result.loaded);
          } else if (
            result.kind === 'file' &&
            isAudioFile(result.file) &&
            onAudioFile
          ) {
            onAudioFile(result.file);
          } else {
            toast.error(
              onAudioFile ? UNRECOGNIZED_MESSAGE : CHART_ONLY_MESSAGE,
            );
          }
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : UNRECOGNIZED_MESSAGE,
          );
        } finally {
          setIsReading(false);
        }
      })();
    },
    [inert, onAudioFile, onChartLoaded],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (isOverNestedZone(e)) {
        // The nested zone owns this drag; make sure the section's own
        // highlight is not left on underneath it.
        setIsDragging(false);
        return;
      }
      e.preventDefault();
      if (!inert) setIsDragging(true);
    },
    [inert],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Moving between children fires dragleave on the wrapper too; only a
    // pointer that actually left the section should clear the highlight.
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    setIsDragging(false);
  }, []);

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={cn(
        'rounded-lg border-2 border-dashed transition-colors',
        isDragging
          ? 'border-primary bg-primary/5'
          : 'border-transparent bg-transparent',
        className,
      )}>
      {children}
    </div>
  );
}
