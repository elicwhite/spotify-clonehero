'use client';

/**
 * "Add Lyrics" dialog for the drum-transcription editor (plan 0063 Part C).
 *
 * Reuses the `/add-lyrics` alignment pipeline (aligner.ts) but feeds it the
 * project's roformer-separated vocals stem instead of running Demucs: the
 * stem is stored Opus-encoded in the fingerprint-keyed stem cache
 * (`vocals.opus`) by `separateDrums` (roformer-separation.ts). If a project's
 * cache entry predates vocals capture, this dialog runs separation first.
 *
 * No tier-2 Demucs retry here — that fallback is `/add-lyrics`-specific.
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
import ProcessingView, {type ProcessingStep} from '@/components/ProcessingView';
import {useChartEditorContext} from './ChartEditorContext';
import {useExecuteCommand} from './hooks/useEditCommands';
import {ReplaceLyricsCommand, hasExistingLyrics} from './commands';
import {
  hasVocalsStem,
  loadVocalsStem,
  separateDrums,
} from '@/lib/drum-transcription/ml/roformer-separation';
import {loadFullMixPcm} from '@/lib/drum-transcription/storage/opfs';

type StepKey = 'separate' | 'load' | 'syllabify' | 'align';

interface StepState {
  key: StepKey;
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
  detail?: string | undefined;
  progress?: number | undefined;
  etaSeconds?: number | undefined;
}

const BASE_STEPS: StepState[] = [
  {key: 'load', label: 'Loading vocals stem', status: 'pending'},
  {
    key: 'syllabify',
    label: 'Splitting lyrics into syllables',
    status: 'pending',
  },
  {key: 'align', label: 'Aligning syllables to audio', status: 'pending'},
];

const SEPARATE_STEP: StepState = {
  key: 'separate',
  label: 'Separating vocals from the mix',
  status: 'pending',
};

function toProcessingSteps(steps: StepState[]): ProcessingStep[] {
  return steps.map(s => ({
    key: s.key,
    label: s.label,
    status: s.status,
    detail: s.detail,
    progress: s.progress,
    etaSeconds: s.etaSeconds,
  }));
}

type Status = 'input' | 'processing' | 'error';

interface AddLyricsDialogProps {
  /** OPFS project id — used to locate/produce the vocals stem. */
  projectId: string;
  /** Called after this dialog runs separation and a fresh vocals stem lands
   *  in the cache — lets the host refresh anything derived from it (e.g. the
   *  piano-roll lyrics row's background waveform). */
  onVocalsStemChanged?: () => void;
}

export default function AddLyricsDialog({
  projectId,
  onVocalsStemChanged,
}: AddLyricsDialogProps) {
  const {state} = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();

  const [open, setOpen] = useState(false);
  const [lyrics, setLyrics] = useState('');
  const [status, setStatus] = useState<Status>('input');
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepState[]>(BASE_STEPS);
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
    setSteps(BASE_STEPS);
    setWarningAcked(false);
  }, []);

  const updateStep = useCallback((key: StepKey, update: Partial<StepState>) => {
    setSteps(prev => prev.map(s => (s.key === key ? {...s, ...update} : s)));
  }, []);

  const handleAlign = useCallback(async () => {
    if (!state.chartDoc || !lyrics.trim()) return;

    setError(null);
    setStatus('processing');

    try {
      const alreadySeparated = await hasVocalsStem(projectId);
      const initialSteps = alreadySeparated
        ? BASE_STEPS.map(s => ({...s}))
        : [SEPARATE_STEP, ...BASE_STEPS].map(s => ({...s}));
      setSteps(initialSteps);

      if (!alreadySeparated) {
        updateStep('separate', {status: 'active', detail: 'Loading model...'});
        const fullMix = await loadFullMixPcm(projectId);
        await separateDrums(projectId, fullMix, p => {
          updateStep('separate', {
            progress: p.percent,
            etaSeconds: p.etaSeconds,
            detail:
              p.step === 'loading-model'
                ? 'Loading separator model...'
                : p.step === 'processing'
                  ? 'Separating stems...'
                  : p.step === 'storing'
                    ? 'Storing stems...'
                    : 'Done',
          });
        });
        updateStep('separate', {status: 'done'});
        onVocalsStemChanged?.();
      }

      updateStep('load', {status: 'active', detail: 'Decoding vocals stem...'});
      const vocalsOpus = await loadVocalsStem(projectId);
      const {resampleTo16kMono} = await import(
        '@/lib/lyrics-align/demucs-client'
      );
      const vocals16k = await resampleTo16kMono(vocalsOpus, 'audio/opus');
      updateStep('load', {
        status: 'done',
        detail: `${(vocals16k.length / 16000).toFixed(1)}s mono 16kHz`,
      });

      updateStep('align', {status: 'active'});
      const {alignVocals} = await import('@/lib/lyrics-align/aligner');
      const result = await alignVocals(vocals16k, lyrics, msg => {
        if (msg.startsWith('Syllabified:')) {
          updateStep('syllabify', {status: 'done'});
        } else if (msg.startsWith('Done:')) {
          updateStep('align', {status: 'done'});
        }
      });

      const command = new ReplaceLyricsCommand(result.syllables);
      executeCommand(command);

      toast.success('Lyrics added to the chart');
      setOpen(false);
      resetForClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus('error');
      setSteps(prev =>
        prev.map(s =>
          s.status === 'active' ? {...s, status: 'error', detail: msg} : s,
        ),
      );
    }
  }, [
    state.chartDoc,
    lyrics,
    projectId,
    executeCommand,
    updateStep,
    resetForClose,
    onVocalsStemChanged,
  ]);

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next && status === 'processing') return; // don't close mid-run
        setOpen(next);
        if (!next) resetForClose();
      }}>
      <Button
        variant="outline"
        size="sm"
        className="w-full gap-2"
        onClick={() => setOpen(true)}>
        <AudioWaveform className="h-4 w-4" />
        Add Lyrics
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Lyrics</DialogTitle>
          <DialogDescription>
            Paste the song lyrics — they&apos;re automatically split into
            syllables, each line becomes its own phrase, and syllables are
            auto-aligned to the audio using the project&apos;s separated vocals
            stem.
          </DialogDescription>
        </DialogHeader>

        {status === 'processing' ? (
          <ProcessingView
            title="Aligning lyrics"
            steps={toProcessingSteps(steps)}
            error={error}
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
