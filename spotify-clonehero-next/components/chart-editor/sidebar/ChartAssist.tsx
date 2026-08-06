'use client';

/**
 * Chart Assist sidebar section (plan 0074 Phase 2, Design C).
 *
 * Cards: Tempo map, Sections (its own LinkSeg run, staleness + Keep-as-is),
 * Add leading silence (detector-driven call-to-action), Drum transcription
 * (staleness + Run/Keep-as-is), Lyrics, and a per-instrument difficulty
 * generation card (one per stale instrument) — one module each, beside this
 * one.
 *
 * This module owns only which cards exist and the section chrome around
 * them. A card that runs a task starts it on the editor's shared assist
 * runner (`useOptionalAssistRunnerContext`) via `useAssistTaskRun` and
 * renders `AssistRunCard` inline while it runs — the same "one renderer, two
 * shells" contract Phase 1 established for the Add Lyrics dialog. Only
 * `ConnectedAssistRunCard` subscribes to run-state ticks; the cards
 * themselves subscribe through `useAssistRunActivity`, whose snapshot ignores
 * step progress, so a running task never re-renders itself or its siblings on
 * a progress tick.
 *
 * **A card renders only when it has something to say.** The host page
 * supplies the audio loader / sample rate a card needs, and a
 * card with no wiring at all is not rendered — there is nothing to show and
 * nothing to run. A host that has the card's INFORMATION but cannot perform
 * its ACTION is the other case: it passes a `*DisabledReason`, and the card
 * renders its status and recommendation with the action disabled and that
 * reason on the tooltip. `/drum-transcription` wires all four to run;
 * `/tempo` wires the leading-silence card only; the shared `TrackEditPage`
 * shell (`/chart-editor`) pads its own playback and exported audio
 * (`usePaddedAudio`), so it runs every audio-backed task honestly, drum
 * transcription included — that one separates its own drum stem out of the
 * song mix the host supplies, so it needs no project behind it. A bare
 * `ChartEditor` with no wiring renders no section at all.
 */

import {useState} from 'react';

import {useChartEditorContext} from '../ChartEditorContext';
import {useExecuteCommand} from '../hooks/useEditCommands';
import {
  selectDifficultyStale,
  selectTempoDerivedStale,
  SUPPORTED_TRACK_INSTRUMENTS,
} from '@/lib/chart-editor-core';
import {findTrack} from '@/lib/chart-edit';
import {useOptionalAssistRunnerContext} from '@/components/assist/AssistRunnerProvider';
import {trackKeyId} from '../scope';
import LearnMoreModal from './LearnMoreModal';
import SectionHeading, {SIDEBAR_SECTION_CLASS} from './SectionHeading';
import {LEARN_COPY, type LearnKey} from './learn-copy';
import type {LoadAssistAudio} from '@/lib/assist/tasks/types';
import TempoMapCard from './TempoMapCard';
import SectionsCard from './SectionsCard';
import LeadingSilenceCard from './LeadingSilenceCard';
import DrumTranscriptionCard from './DrumTranscriptionCard';
import DifficultyGenerationCard from './DifficultyGenerationCard';
import LyricsCard from './LyricsCard';

export interface ChartAssistProps {
  /** Whether re-running drum transcription is offered at all. */
  allowDrumRerun?: boolean | undefined;
  /** Loads the song's audio (with the stem-cache fingerprint it's keyed
   *  under, when the host knows it) for the Tempo map card's
   *  `generate-tempo-map` task, the Lyrics card's `add-lyrics` task, and the
   *  Drum transcription card. Without it none of those cards renders. */
  loadAudio?: LoadAssistAudio | undefined;
  /** Sample rate of the loaded audio, for the leading-silence pad's sample
   *  quantization. Without it the Add leading silence card doesn't render. */
  audioSampleRate?: number | undefined;
  /** Why this host can't add leading silence: padding the chart is only half
   *  the operation, and a host that can't also pad the audio it plays and
   *  exports would leave the two drifted apart. The card still renders its
   *  detector recommendation, with the action disabled and this on the
   *  tooltip. */
  leadingSilenceDisabledReason?: string | undefined;
  /** Why this host can't run drum transcription at all. It applies only to a
   *  host that offers no `loadAudio` — with it the run has everything it
   *  needs, since it separates its own drum stem. The card still renders its
   *  note count, staleness note, and "Keep as-is". */
  drumRerunDisabledReason?: string | undefined;
  /** Set while the host is rebuilding its padded audio: audio-dependent
   *  actions disable and explain themselves with this reason. */
  audioBusyReason?: string | undefined;
  /** A detected audio onset in chart-ms domain (tick 0 == ms 0), for the
   *  leading-silence detector's second trigger. Omit when not computed. */
  detectedAudioOnsetMs?: number | undefined;
  /** Forwarded to `AddLyricsDialog` — called after a run that aligned
   *  against cached roformer vocals. */
  onLyricsAlignedFromCachedVocals?: (() => void) | undefined;
}

export default function ChartAssist({
  allowDrumRerun = true,
  loadAudio,
  audioSampleRate,
  leadingSilenceDisabledReason,
  drumRerunDisabledReason,
  audioBusyReason,
  detectedAudioOnsetMs,
  onLyricsAlignedFromCachedVocals,
}: ChartAssistProps) {
  const {state, capabilities} = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();
  const runner = useOptionalAssistRunnerContext();
  const [learnOpen, setLearnOpen] = useState<LearnKey | null>(null);

  const variant = capabilities.chartAssist;
  const doc = state.chartDoc;
  const hasDrumsTrack =
    doc != null &&
    findTrack(doc, {instrument: 'drums', difficulty: 'expert'}) != null;

  // Card visibility = capability variant AND either the wiring that card's
  // action needs, or a host-supplied reason it can't run here. A card with
  // neither is absent.
  // Tempo map and Sections need the same wiring: a runner plus the song's
  // audio, since each is its own pipeline run installed as a chart edit.
  const showAudioBackedCards =
    (variant === 'all' || variant === 'tempo-and-silence') &&
    runner != null &&
    loadAudio != null;
  // Leading silence pads the audio in a worker under a progress card, so it
  // needs a runner too — same as the other cards that do real work.
  const showSilence =
    (variant === 'all' || variant === 'tempo-and-silence') &&
    runner != null &&
    doc != null &&
    audioSampleRate !== undefined;
  // Drum transcription runs from the host's audio, which it separates
  // itself — so a host-declared reason it can't run only applies when the
  // host has none. It also waits out a padded-audio rebuild, like every
  // other audio-backed card.
  const drumDisabledReason =
    loadAudio != null ? audioBusyReason : drumRerunDisabledReason;
  const showDrums =
    variant === 'all' &&
    allowDrumRerun &&
    runner != null &&
    (loadAudio != null || drumRerunDisabledReason !== undefined) &&
    hasDrumsTrack;
  const showLyrics =
    (variant === 'all' || variant === 'lyrics-only') && loadAudio != null;

  // Difficulty regeneration cards: one per instrument whose Hard/Medium/Easy
  // set was generated from an Expert track that has since changed. Runs the
  // same `generate-difficulties` task the Chart Matrix row's generate
  // affordance starts (plan 0074 Design C/D).
  const staleDifficultyInstruments =
    variant === 'all' && runner != null && doc != null
      ? SUPPORTED_TRACK_INSTRUMENTS.filter(
          instrument =>
            findTrack(doc, {instrument, difficulty: 'expert'}) != null &&
            selectDifficultyStale(
              state,
              instrument,
              trackKeyId({instrument, difficulty: 'expert'}),
            ),
        )
      : [];

  if (
    !showAudioBackedCards &&
    !showSilence &&
    !showDrums &&
    !showLyrics &&
    staleDifficultyInstruments.length === 0
  ) {
    return null;
  }

  return (
    <div className={SIDEBAR_SECTION_CLASS}>
      <SectionHeading title="Chart Assist" />
      {/* Card gap: the prototype's 6px between stacked assist cards. */}
      <div className="space-y-1.5">
        {showAudioBackedCards && (
          <TempoMapCard
            runner={runner}
            loadAudio={loadAudio}
            audioBusyReason={audioBusyReason}
            executeCommand={executeCommand}
            onLearnMore={setLearnOpen}
          />
        )}
        {showAudioBackedCards && (
          <SectionsCard
            doc={doc}
            stale={selectTempoDerivedStale(state, 'sections')}
            runner={runner}
            loadAudio={loadAudio}
            audioBusyReason={audioBusyReason}
            executeCommand={executeCommand}
            onLearnMore={setLearnOpen}
          />
        )}
        {showSilence && (
          <LeadingSilenceCard
            doc={doc}
            runner={runner}
            audioSampleRate={audioSampleRate}
            audioBusyReason={audioBusyReason}
            disabledReason={leadingSilenceDisabledReason}
            detectedAudioOnsetMs={detectedAudioOnsetMs}
            executeCommand={executeCommand}
            onLearnMore={setLearnOpen}
          />
        )}
        {showDrums && (
          <DrumTranscriptionCard
            doc={doc}
            stale={selectTempoDerivedStale(state, 'drum-transcription')}
            loadAudio={loadAudio}
            rerunDisabledReason={drumDisabledReason}
            runner={runner}
            executeCommand={executeCommand}
            onLearnMore={setLearnOpen}
          />
        )}
        {showLyrics && (
          <LyricsCard
            loadAudio={loadAudio}
            onAlignedFromCachedVocals={onLyricsAlignedFromCachedVocals}
            onLearnMore={setLearnOpen}
          />
        )}
        {staleDifficultyInstruments.map(instrument => (
          <DifficultyGenerationCard
            key={instrument}
            instrument={instrument}
            onLearnMore={setLearnOpen}
          />
        ))}
      </div>

      {learnOpen && (
        <LearnMoreModal
          open
          onOpenChange={open => {
            if (!open) setLearnOpen(null);
          }}
          title={LEARN_COPY[learnOpen].title}
          paragraphs={LEARN_COPY[learnOpen].paragraphs}
        />
      )}
    </div>
  );
}
