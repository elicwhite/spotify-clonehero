'use client';

import {useState, useCallback, useMemo} from 'react';
import {Loader2} from 'lucide-react';
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
import {Separator} from '@/components/ui/separator';
import type {ParsedChart} from '@/lib/chart-edit';
import {
  DIFFICULTY_FIELD_LABEL,
  difficultyFieldsForChart,
  explainRecommendation,
  resolveDifficultyRecommendation,
  type DifficultyField,
  type RecommendedInstrument,
} from '@/lib/chart-difficulty';

import type {SongIniMetadataValue} from '@/lib/chart-editor-core';

import SongMetadataFields, {
  DifficultyRow,
  SongCatalogFields,
  type DifficultySuggestion,
} from './SongMetadataFields';

/** The `diff_*` fields the drum calculator speaks to. Both get the same score:
 *  the calculator rates the Expert Pro Drums arrangement, and this project
 *  authors no separate generic-Drums arrangement to rate differently. */
const DRUM_FIELDS: readonly DifficultyField[] = [
  'diff_drums',
  'diff_drums_real',
];

/**
 * Which field each calculator rates.
 *
 * `diff_drums` is deliberately absent: the drum calculator rates the Expert
 * Pro Drums arrangement, so the suggestion belongs on the Pro Drums row, and
 * accepting it fills both drum fields anyway.
 */
const SUGGESTED_FIELDS: Readonly<
  Partial<Record<DifficultyField, RecommendedInstrument>>
> = {
  diff_guitar: 'guitar',
  diff_bass: 'bass',
  diff_drums_real: 'drums',
};

interface SongMetadataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current values, used to seed the form when the dialog opens. */
  value: SongIniMetadataValue;
  /** Persist the edited metadata. May be async. */
  onSave: (value: SongIniMetadataValue) => void | Promise<void>;
  /** The chart being edited — the difficulty rows offered and the drum
   *  recommendation are both derived from it. */
  chart: Pick<ParsedChart, 'trackData' | 'tempos'>;
  /** Content stamp of the Expert drums track as it stands right now, compared
   *  against `value.drumDifficultyStamp` to spot a stored intensity that was
   *  chosen for an earlier version of the chart. */
  currentDrumStamp?: string | undefined;
}

/**
 * The song-details editor: everything this project writes into `song.ini`.
 *
 * Identity (song / artist / charter), catalog fields (album / genre / year),
 * and a per-instrument intensity for each instrument the chart actually
 * contains. Guitar, bass and Pro Drums additionally carry a suggestion from the
 * chart-only Expert calculators (`lib/chart-difficulty`), offered beside the
 * field rather than written into it.
 */
export default function SongMetadataDialog({
  open,
  onOpenChange,
  value,
  onSave,
  chart,
  currentDrumStamp,
}: SongMetadataDialogProps) {
  const [draft, setDraft] = useState<SongIniMetadataValue>(value);
  const [isSaving, setIsSaving] = useState(false);

  // Seed the form from the chart on every open, so a cancelled edit is
  // discarded and anything the host changed meanwhile is picked up. `open` is
  // owned by the host and can be raised without going through
  // `onOpenChange`, so this reads the transition during render rather than
  // hanging the reseed off the close handler.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(value);
  }

  const fields = useMemo(() => difficultyFieldsForChart(chart), [chart]);

  // Scoring walks every note in an instrument's Expert track, so it only runs
  // while the dialog is on screen — the host re-renders this component on
  // every chart edit. The explanation carries the recommendation itself, so
  // one pass per instrument feeds both the number and the copy naming it.
  const explanations = useMemo(() => {
    const byInstrument = new Map<
      RecommendedInstrument,
      ReturnType<typeof explainRecommendation>
    >();
    if (!open) return byInstrument;
    for (const field of fields) {
      const instrument = SUGGESTED_FIELDS[field];
      if (instrument) {
        byInstrument.set(instrument, explainRecommendation(chart, instrument));
      }
    }
    return byInstrument;
  }, [chart, fields, open]);

  const setDifficulty = useCallback(
    (field: DifficultyField, next: number | null) => {
      setDraft(prev => ({
        ...prev,
        difficulties: {...prev.difficulties, [field]: next},
        // Choosing a drums intensity re-anchors its provenance to the chart as
        // it is right now, which is what clears a staleness prompt.
        ...(DRUM_FIELDS.includes(field)
          ? {drumDifficultyStamp: currentDrumStamp}
          : {}),
      }));
    },
    [currentDrumStamp],
  );

  // A four-lane Pro Drums chart is expected to declare the same intensity in
  // both drum fields, and plain Drums has no row of its own, so every way of
  // choosing a drums intensity (the Pro Drums select and its suggestion alike)
  // writes both.
  const setDrumDifficulty = useCallback(
    (next: number | null) => {
      setDraft(prev => ({
        ...prev,
        difficulties: {
          ...prev.difficulties,
          diff_drums: next,
          diff_drums_real: next,
        },
        drumDifficultyStamp: currentDrumStamp,
      }));
    },
    [currentDrumStamp],
  );

  // Only drums carries a content stamp, so only drums can go stale; the 5-fret
  // rows have no recorded "chart as it was when this was chosen" to compare
  // against and read as a plain agreement or disagreement.
  const suggestionFor = (
    field: DifficultyField,
  ): DifficultySuggestion | undefined => {
    const instrument = SUGGESTED_FIELDS[field];
    if (!instrument) return undefined;
    const explanation = explanations.get(instrument) ?? null;
    const isDrums = instrument === 'drums';
    return {
      explanation,
      state: resolveDifficultyRecommendation({
        stored: draft.difficulties[field] ?? null,
        recommended: explanation?.recommended ?? null,
        sourceStampAtSet: isDrums ? draft.drumDifficultyStamp : undefined,
        currentSourceStamp: isDrums ? currentDrumStamp : undefined,
      }),
      onApply: isDrums ? setDrumDifficulty : next => setDifficulty(field, next),
    };
  };

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await onSave({
        ...draft,
        name: draft.name.trim() || 'Untitled',
        artist: draft.artist.trim(),
        charter: draft.charter.trim(),
        album: draft.album.trim(),
        genre: draft.genre.trim(),
        year: draft.year.trim(),
      });
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  }, [draft, onSave, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Song Details</DialogTitle>
          <DialogDescription>
            Everything here is written to the chart&apos;s <code>song.ini</code>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <SongMetadataFields
            value={draft}
            onChange={next => setDraft(prev => ({...prev, ...next}))}
            idPrefix="song-details"
          />
          <SongCatalogFields
            value={draft}
            onChange={setDraft}
            idPrefix="song-details"
          />
        </div>

        {fields.length > 0 && (
          <>
            <Separator />
            <div className="grid gap-4 py-2">
              {fields.map(field => {
                const suggestion = suggestionFor(field);
                return (
                  <DifficultyRow
                    key={field}
                    id={`song-details-${field}`}
                    label={DIFFICULTY_FIELD_LABEL[field]}
                    value={draft.difficulties[field] ?? null}
                    onChange={
                      field === 'diff_drums_real'
                        ? setDrumDifficulty
                        : next => setDifficulty(field, next)
                    }
                    {...(suggestion ? {suggestion} : {})}
                  />
                );
              })}
            </div>
          </>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
