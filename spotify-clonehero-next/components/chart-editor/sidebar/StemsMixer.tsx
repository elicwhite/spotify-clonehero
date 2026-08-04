'use client';

/**
 * Stems mixer sidebar section (plan 0074 Phase 5, Design C). One row per
 * audio track the live `AudioManager` carries (in `trackNames` order), plus
 * the synthesized metronome click as a solo-exempt last row, and — when the
 * host can rebuild its padded AudioManager (`onAddStem` provided) — a
 * drop-a-file-to-add-a-stem row.
 *
 * Volume/mute/solo live entirely in this component's own state: multiple
 * stems may be solo'd at once, and an explicit mute survives solo churn on
 * other rows. `resolveMixer` turns that state into each row's effective
 * volume and solo-silenced flag; this component pushes those volumes to the
 * AudioManager via `setVolume` and renders the rows from the same value.
 * `AudioManager.trackNames` is fixed at construction (construct-once
 * design), so it only actually changes when `audioManager` itself is
 * swapped for a new instance (a padded-audio rebuild, e.g. from a
 * drop-added stem) — row state is keyed off the `audioManager` instance,
 * not off `trackNames`'s array identity, which is a fresh array every
 * render.
 *
 * `capabilities.showStemsMixer` gates the whole section (checked by
 * `LeftSidebar`, mirroring `ChartMatrix`/`ChartAssist`'s own "decide for
 * yourself" convention) — this component's own bailout is simply "no
 * tracks to mix" (`audioManager.trackNames` empty), which shouldn't happen
 * once the host's AudioManager is ready.
 */

import {useEffect, useMemo, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {AudioWaveform, Timer, Upload} from 'lucide-react';
import {toast} from 'sonner';

import type {AudioManager} from '@/lib/preview/audioManager';
import {CLICK_TRACK_NAME} from '@/lib/preview/clickTrack';
import {
  decodeAudio,
  interleaveAudioBuffer,
} from '@/lib/drum-transcription/audio/decoder';
import {pickFiles} from '@/lib/sng/read-dropped-entries';
import {cn} from '@/lib/utils';
import type {AudioStem} from '../hooks/usePaddedAudio';
import InstrumentIcon, {type IconableInstrument} from '../InstrumentIcon';
import SectionHeading, {SIDEBAR_SECTION_CLASS} from './SectionHeading';
import StemMixerRow from './StemMixerRow';
import {defaultVolumeFor, resolveMixer, type MixerRowState} from './mixerBus';

/** A stem's origin, for the AI-separated badge. Keyed by the AudioManager
 *  track name it applies to. Any track absent from this list (typically the
 *  full mix) is treated as `'chart-file'` — nothing in this app plays audio
 *  that didn't ultimately come from the chart package. Hosts pass their
 *  `usePaddedAudio` stem list straight through. */
export type StemOriginEntry = Pick<AudioStem, 'name' | 'origin'>;

/** Host-supplied wiring, threaded through `ChartEditor`/`LeftSidebar` from
 *  the page (`EditorApp`, `TrackEditPage`, ...). Every field is optional —
 *  a host with nothing to add simply renders the mixer against
 *  `audioManager` alone. */
export interface StemsMixerHostProps {
  stemOrigins?: ReadonlyArray<StemOriginEntry> | undefined;
  /**
   * Adds a new stem at runtime. Present only on hosts that can rebuild their
   * padded AudioManager from a stem list (5a's `usePaddedAudio` rebuild
   * path) — omitted, the drop-a-file row doesn't render, since there is no
   * way to add a track to a construct-once `AudioManager` otherwise.
   *
   * `pcm` is always interleaved 44.1 kHz stereo (what `decodeAudio` +
   * `interleaveAudioBuffer` produce, whatever the dropped file was). A host
   * whose `PaddedAudioMeta` says otherwise must reject the stem rather than
   * WAV-encode this data under a header that misdescribes it.
   */
  onAddStem?:
    | ((input: {name: string; pcm: Float32Array; origin: 'user-added'}) => void)
    | undefined;
  /** Track names an in-flight assist run has locked (e.g. `'drums'` during a
   *  drum-transcription re-run). Locked rows keep their current values but
   *  disable their slider/mute/solo controls; unrelated rows, and the rest
   *  of the editor (transport, A/B loop), stay interactive. */
  lockedTrackNames?: ReadonlySet<string> | undefined;
}

export interface StemsMixerProps extends StemsMixerHostProps {
  audioManager: AudioManager;
}

function displayLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The instruments a stem row can be iconified as (plan 0076 item 9: the
 *  instrument PNGs everywhere an instrument is represented by an icon). A
 *  row whose name doesn't name one of them - the full mix, a dropped stem,
 *  a `rhythm`/`keys` track with no art - keeps the generic waveform. */
const ICONABLE_STEM_INSTRUMENTS: readonly IconableInstrument[] = [
  'drums',
  'guitar',
  'bass',
  'vocals',
];

/** Icon element for a stem row. Matches on substring because AudioManager
 *  track names carry the package's own file names (`drums_1`, `rhythm`). */
function stemIcon(name: string): ReactNode {
  const lower = name.toLowerCase();
  const instrument = ICONABLE_STEM_INSTRUMENTS.find(i => lower.includes(i));
  return instrument ? (
    <InstrumentIcon instrument={instrument} />
  ) : (
    <AudioWaveform />
  );
}

/**
 * `AudioManager` plays every file whose name contains `drums` as a single
 * `drums` track, so a stem named `drums.wav` (or `eardrums.wav`) would be
 * folded into that track: its audio would play under the Drums fader and it
 * would never get a row of its own, since rows come from `trackNames`.
 * Rewrite such names so the track AudioManager creates is exactly the name
 * handed to the host.
 */
function stemNameForOwnTrack(base: string): string {
  if (base === 'drums' || !base.includes('drums')) return base;
  return base.replaceAll('drums', 'drum');
}

/** Uniquifies a dropped file's base name against the stems already on the
 *  mixer (plus any still-pending adds), appending " 2", " 3", ... on
 *  collision rather than silently overwriting an existing track. */
function uniqueStemName(base: string, existing: ReadonlySet<string>): string {
  const wanted = stemNameForOwnTrack(base);
  if (!existing.has(wanted)) return wanted;
  let n = 2;
  let candidate = stemNameForOwnTrack(`${wanted} ${n}`);
  while (existing.has(candidate)) {
    n++;
    candidate = stemNameForOwnTrack(`${wanted} ${n}`);
  }
  return candidate;
}

/** A default row for every track name, reusing an existing row's values
 *  where the name is already known (so live volume/mute/solo survives a
 *  stem-list rebuild for the stems that persist across it). */
function seedRows(
  trackNames: readonly string[],
  prev: Record<string, MixerRowState>,
): Record<string, MixerRowState> {
  const next: Record<string, MixerRowState> = {};
  for (const name of trackNames) {
    next[name] = prev[name] ?? {
      volume: defaultVolumeFor(name),
      mute: false,
      solo: false,
    };
  }
  return next;
}

export default function StemsMixer({
  audioManager,
  stemOrigins,
  onAddStem,
  lockedTrackNames,
}: StemsMixerProps) {
  const trackNames = audioManager.trackNames;
  const [rows, setRows] = useState<Record<string, MixerRowState>>(() =>
    seedRows(trackNames, {}),
  );
  const [dragOver, setDragOver] = useState(false);

  // `AudioManager.trackNames` is fixed at construction, so it only actually
  // changes when `audioManager` itself is a new instance (the padded-audio
  // rebuild-and-swap, e.g. from a drop-added stem). Re-seed rows for the new
  // track list right here during render (React's documented "adjusting
  // state when a prop changes" pattern — a plain state comparison, not an
  // effect, so there's no extra commit) when that happens; existing stems
  // keep their live values via `seedRows`'s `prev[name] ?? ...` fallback.
  const [seededForAudioManager, setSeededForAudioManager] =
    useState(audioManager);
  // Names handed to `onAddStem` since the last swap. The host's rebuild
  // takes seconds, during which `trackNames` still describes the OLD
  // manager, so a second drop in that window has to uniquify against these
  // too or both stems would be named the same and the host would build two
  // tracks with one name (last one wins, the other leaks).
  const pendingStemNamesRef = useRef<string[]>([]);
  if (seededForAudioManager !== audioManager) {
    setSeededForAudioManager(audioManager);
    setRows(prev => seedRows(trackNames, prev));
  }

  // The rebuild landed: every pending name is now a real track name.
  useEffect(() => {
    pendingStemNamesRef.current = [];
  }, [audioManager]);

  // The solo bus, resolved once per render: the same value drives what the
  // AudioManager plays and how each row draws itself.
  const {anySolo, resolved} = useMemo(() => resolveMixer(rows), [rows]);

  useEffect(() => {
    for (const [name, row] of Object.entries(resolved)) {
      audioManager.setVolume(name, row.volume);
    }
  }, [audioManager, resolved]);

  const originByName = useMemo(() => {
    const map = new Map<string, AudioStem['origin']>();
    for (const entry of stemOrigins ?? []) map.set(entry.name, entry.origin);
    return map;
  }, [stemOrigins]);

  const orderedNames = [
    ...trackNames.filter(name => name !== CLICK_TRACK_NAME),
    ...(trackNames.includes(CLICK_TRACK_NAME) ? [CLICK_TRACK_NAME] : []),
  ];

  const updateRow = (name: string, patch: Partial<MixerRowState>) => {
    setRows(prev => ({...prev, [name]: {...prev[name], ...patch}}));
  };

  const addStemFromFile = async (file: File) => {
    if (!onAddStem) return;
    try {
      const buffer = await file.arrayBuffer();
      const decoded = await decodeAudio(buffer);
      const pcm = interleaveAudioBuffer(decoded);
      const baseName = file.name.replace(/\.[^./]+$/, '') || file.name;
      const name = uniqueStemName(
        baseName,
        new Set([...trackNames, ...pendingStemNamesRef.current]),
      );
      pendingStemNamesRef.current.push(name);
      onAddStem({name, pcm, origin: 'user-added'});
      toast.success(`Added stem "${name}"`);
    } catch (err) {
      console.error('Failed to add stem from dropped file:', err);
      toast.error('Could not read that audio file');
    }
  };

  // One stem per pick: each added stem needs its own uniquified name and its
  // own host rebuild, so the picker is single-select rather than adding a
  // batch the user can't tell apart afterwards.
  const pickStemFile = async () => {
    try {
      // A distinct picker id keeps its own remembered location.
      const files = await pickFiles({
        id: 'chart-editor-add-stem',
        multiple: false,
        types: [
          {description: 'Audio', accept: {'audio/*': ['.wav', '.mp3', '.ogg']}},
        ],
      });
      const file = files?.[0];
      if (file) await addStemFromFile(file);
    } catch (err) {
      console.error('Failed to pick an audio file:', err);
      toast.error('Could not open the file picker');
    }
  };

  if (trackNames.length === 0) return null;

  return (
    <div className={cn(SIDEBAR_SECTION_CLASS, 'space-y-1.5')}>
      {/* The prototype puts the solo indicator in the section heading row
       *  rather than under the rows. Double-click resets a slider, unhinted
       *  (plan 0076 item 17) — it's the same convention as the piano roll
       *  and A/B loop markers. */}
      <SectionHeading title="Stems">
        {anySolo && (
          <span className="ml-auto text-[9px] font-bold uppercase tracking-[0.05em] text-green-600 dark:text-green-400">
            Solo
          </span>
        )}
      </SectionHeading>

      <div className="space-y-0.5">
        {orderedNames.map(name => {
          const row = rows[name];
          if (!row) return null;
          const isClick = name === CLICK_TRACK_NAME;
          const origin = originByName.get(name) ?? 'chart-file';
          const locked = lockedTrackNames?.has(name) ?? false;
          return (
            <StemMixerRow
              key={name}
              name={name}
              label={isClick ? 'Click' : displayLabel(name)}
              volume={row.volume}
              mute={row.mute}
              solo={row.solo}
              icon={isClick ? <Timer /> : stemIcon(name)}
              topSeparator={isClick}
              soloExempt={isClick}
              dimmedBySolo={resolved[name].dimmedBySolo}
              aiSeparated={!isClick && origin === 'ai-separated'}
              locked={locked}
              onVolumeChange={v => updateRow(name, {volume: v})}
              onReset={() => updateRow(name, {volume: defaultVolumeFor(name)})}
              onToggleMute={() => updateRow(name, {mute: !row.mute})}
              onToggleSolo={
                isClick ? undefined : () => updateRow(name, {solo: !row.solo})
              }
            />
          );
        })}
      </div>

      {onAddStem && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop an audio file to add a stem"
          onDragOver={e => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) void addStemFromFile(file);
          }}
          onClick={() => void pickStemFile()}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              (e.currentTarget as HTMLElement).click();
            }
          }}
          className={cn(
            'flex h-7 items-center justify-center gap-1.5 rounded-md border border-dashed text-[11px] text-muted-foreground transition-colors cursor-pointer',
            dragOver
              ? 'border-primary text-primary bg-primary/5'
              : 'hover:border-primary/60 hover:text-foreground',
          )}>
          <Upload className="h-3 w-3" />
          Drop an audio file to add a stem
        </div>
      )}
    </div>
  );
}
