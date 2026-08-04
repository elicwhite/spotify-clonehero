'use client';

/**
 * "Add Lyrics" dialog for the chart editor (plan 0063 Part C, plan 0074).
 *
 * Drives `lib/assist/tasks/add-lyrics.ts`'s `add-lyrics` task on the editor's
 * shared assist runner:
 * roformer-separated vocals cached from drum transcription (fingerprint-
 * keyed OPFS cache) are reused when present; otherwise the task falls back
 * to a fresh Demucs separation of the merged audio. Same task, same step
 * list, same math as the `/add-lyrics` standalone page — this dialog only
 * keeps its own modal shell and paste textarea.
 */

import {useCallback, useEffect, useState} from 'react';
import {AudioWaveform, TriangleAlert} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import ConnectedProcessingView from '@/components/assist/ConnectedProcessingView';
import {useChartEditorContext} from './ChartEditorContext';
import {useExecuteCommand} from './hooks/useEditCommands';
import {ReplaceLyricsCommand, hasExistingLyrics} from './commands';
import {useAssistRunnerContext} from '@/components/assist/AssistRunnerProvider';
import {addLyricsTask} from '@/lib/assist/tasks/add-lyrics';
import type {LoadAssistAudio} from '@/lib/assist/tasks/types';
import {isAbortError} from '@/lib/workers/abortable-worker';

type Status = 'input' | 'processing' | 'error';

interface AddLyricsDialogProps {
  /**
   * The song's audio, as the host can supply it. A project-backed host
   * (`/drum-transcription`) returns the project's persisted stem
   * fingerprint, so a cached roformer vocals stem is reused and the bytes
   * are never read; a host with only the chart package's audio files
   * returns bytes alone and the task separates vocals with Demucs.
   */
  loadAudio: LoadAssistAudio;
  /**
   * Called after a successful run that aligned against the project's cached
   * roformer vocals, so the host can pick that stem up for surfaces which
   * render it (the piano-roll lyrics row's background waveform).
   */
  onAlignedFromCachedVocals?: (() => void) | undefined;
}

export default function AddLyricsDialog({
  loadAudio,
  onAlignedFromCachedVocals,
}: AddLyricsDialogProps) {
  const {state} = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();
  // The editor's single runner, shared with the Regenerate control: only one
  // assist task runs at a time across the editor, and closing the editor
  // aborts it.
  const {
    store: assistStore,
    start: startAssistTask,
    cancel: cancelAssistTask,
  } = useAssistRunnerContext();

  const [open, setOpen] = useState(false);
  const [lyrics, setLyrics] = useState('');
  const [status, setStatus] = useState<Status>('input');
  const [error, setError] = useState<string | null>(null);
  const [warningAcked, setWarningAcked] = useState(false);

  const existingLyrics = Boolean(
    state.chartDoc && hasExistingLyrics(state.chartDoc.parsedChart.vocalTracks),
  );

  // Preload the alignment model in its worker as soon as the dialog opens,
  // so it's ready by the time the user hits Align.
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const {init} = await import('@/lib/lyrics-align/aligner');
        await init();
      } catch (e: unknown) {
        console.warn('Failed to preload alignment model:', e);
      }
    })();
  }, [open]);

  const resetForClose = useCallback(() => {
    setLyrics('');
    setStatus('input');
    setError(null);
    setWarningAcked(false);
  }, []);

  const handleAlign = useCallback(async () => {
    if (!state.chartDoc || !lyrics.trim()) return;

    setError(null);
    setStatus('processing');

    try {
      // `loadAudio` resolves lazily: a host that knows the project's
      // persisted stem fingerprint hands it over so the task probes the
      // cache under the key the stems were actually stored under, and the
      // bytes themselves are only read if that probe misses and the Demucs
      // fallback runs.
      const result = await startAssistTask(addLyricsTask, {
        lyrics,
        vocals: {kind: 'resolve', audio: await loadAudio()},
      });

      const command = new ReplaceLyricsCommand(result.syllables);
      executeCommand(command);

      if (result.vocalsSource === 'cache') onAlignedFromCachedVocals?.();

      toast.success('Lyrics added to the chart');
      setOpen(false);
      resetForClose();
    } catch (e) {
      if (isAbortError(e)) {
        // Cancelled: back to the paste form with the lyrics still in it.
        setStatus('input');
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus('error');
    }
  }, [
    state.chartDoc,
    lyrics,
    loadAudio,
    executeCommand,
    startAssistTask,
    resetForClose,
    onAlignedFromCachedVocals,
  ]);

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        // Closing mid-run cancels it (terminating the worker) rather than
        // leaving it running behind a dismissed dialog.
        if (!next && status === 'processing') cancelAssistTask();
        setOpen(next);
        if (!next) resetForClose();
      }}>
      {/* Plan 0076 item 14: same `xs` scale as every other card's
       *  `CardAction` button, so this sits on the actions row beside "Learn
       *  more" instead of standing out as a full-width outlier. */}
      <Button variant="outline" size="xs" onClick={() => setOpen(true)}>
        <AudioWaveform />
        Add Lyrics
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Lyrics</DialogTitle>
          <DialogDescription>
            Paste the song lyrics — they&apos;re automatically split into
            syllables, each line becomes its own phrase, and syllables are
            auto-aligned to the song&apos;s isolated vocals.
          </DialogDescription>
        </DialogHeader>

        {status === 'processing' ? (
          <ConnectedProcessingView
            store={assistStore}
            taskKey="add-lyrics"
            title="Aligning lyrics"
            onCancel={cancelAssistTask}
            className="max-w-none border-0 shadow-none p-0"
          />
        ) : (
          <div className="space-y-4">
            {existingLyrics && !warningAcked && (
              <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 flex items-start gap-3">
                <TriangleAlert className="h-4 w-4 mt-0.5 text-yellow-700 dark:text-yellow-300 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">
                    This chart already has lyrics. Adding new lyrics will
                    replace the existing vocals track.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => setWarningAcked(true)}>
                    OK, continue
                  </Button>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">
                Paste Lyrics
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                All pasted text becomes lyrics, so don&apos;t include non-lyric
                symbols or section headers like [Verse]. One line per phrase.
              </p>
              <textarea
                value={lyrics}
                onChange={e => setLyrics(e.target.value)}
                rows={10}
                placeholder="Paste the song lyrics here..."
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary resize-y"
              />
            </div>

            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {status !== 'processing' && (
            <Button
              onClick={handleAlign}
              disabled={!lyrics.trim() || (existingLyrics && !warningAcked)}>
              Align &amp; Add Lyrics
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
