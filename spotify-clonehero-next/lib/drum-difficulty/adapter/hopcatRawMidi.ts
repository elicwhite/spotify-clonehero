/**
 * Raw-MIDI HOPCAT input path — a direct TypeScript port of the eval's
 * `midi_io.py` `read_drum_song`.
 *
 * HOPCAT's Python reference reads the uploaded `notes.mid` bytes directly; it
 * never goes through a chart-resolution layer. The scan-chart-derived adapter
 * (`adapter/hopcat.ts`) has to *reconstruct* HOPCAT's raw-MIDI input model from
 * scan-chart's already-resolved `ParsedChart`, and two pieces of information
 * are lost in that resolution and cannot be rebuilt from per-note flags:
 *   - the raw 110-112 tom-marker note_on ticks (a run of tom gems could be one
 *     long marker span or one span per gem — indistinguishable after
 *     resolution), and
 *   - the `[mix N drums*]` disco end-marker tick (scan-chart flags the region
 *     half-open; HOPCAT's window is inclusive of the note on the end tick).
 *
 * This module sidesteps both by parsing the raw MIDI itself and building
 * exactly the `Note{pos,pitch,vel,dur}` / `TextEvent{pos,text}` lists
 * `reduce_5lane_drums` expects, straight off the `PART DRUMS` track — the same
 * events HOPCAT's own `midi_io.py` produces. It is the input path for
 * `.mid`-sourced uploads; `.chart`-only uploads (no `notes.mid`) have no raw
 * markers to recover and continue to use the scan-chart-derived adapter.
 *
 * Faithfulness notes vs `midi_io.py`:
 *  - Every note event on the `PART DRUMS` track is read (gems 96-100, 2x-bass
 *    95, tom markers 110-112, roll/swell 126-127, and all passthrough pitches);
 *    `reduce_5lane_drums` classifies tier vs passthrough itself.
 *  - note-off pairing is FIFO per pitch (`pending.pop(0)`), and a `Note` is
 *    emitted at the *note-off* event, so the note list is ordered by note-off
 *    tick exactly as `midi_io.py` produces it (the reducer's `unflip_discobeat`
 *    companion-note first/last-in-file guard is order-sensitive on same-tick
 *    ties, so this order is preserved deliberately).
 *  - a note-off is either a `noteOff` event or a `noteOn` with velocity 0.
 *  - time signatures are collected across all tracks (they live on the
 *    tempo-map track) and fed to the shared `buildMeasures`; `endTick` is the
 *    last tick on the `PART DRUMS` track, matching `read_drum_song`'s
 *    `max_tick`.
 */

import {parseMidi} from '@geomitron/midi-file';
import type {MidiEvent} from '@geomitron/midi-file';

import {buildMeasures} from '../measureMap';
import type {HopcatInput, HopcatNote, HopcatTextEvent} from './hopcat';

const DRUM_TRACK_NAME = 'PART DRUMS';

export class NoDrumTrackError extends Error {
  constructor() {
    super(`no track named '${DRUM_TRACK_NAME}' in this file`);
    this.name = 'NoDrumTrackError';
  }
}

/** The name of the first `trackName` meta event on a track, or null. */
function trackName(track: MidiEvent[]): string | null {
  for (const ev of track) {
    if (ev.type === 'trackName') return ev.text;
  }
  return null;
}

function findDrumTrack(tracks: MidiEvent[][]): MidiEvent[] {
  for (const track of tracks) {
    if (trackName(track) === DRUM_TRACK_NAME) return track;
  }
  throw new NoDrumTrackError();
}

/** (tick, numerator, denominator) time-signature events across all tracks. */
function timeSignatures(
  tracks: MidiEvent[][],
): [tick: number, numerator: number, denominator: number][] {
  const out: [number, number, number][] = [];
  for (const track of tracks) {
    let t = 0;
    for (const ev of track) {
      t += ev.deltaTime;
      if (ev.type === 'timeSignature') {
        out.push([t, ev.numerator, ev.denominator]);
      }
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function isNoteOff(ev: MidiEvent): boolean {
  return (
    ev.type === 'noteOff' || (ev.type === 'noteOn' && ev.velocity === 0)
  );
}

export interface RawMidiHopcatResult extends HopcatInput {
  ticksPerBeat: number;
  hadTimeSignature: boolean;
}

/**
 * Parse raw MIDI bytes into the HOPCAT reducer's input, mirroring
 * `midi_io.read_drum_song`. Throws {@link NoDrumTrackError} if there is no
 * `PART DRUMS` track.
 */
export function parseRawMidiForHopcat(
  midiBytes: ArrayBuffer | Uint8Array,
): RawMidiHopcatResult {
  const bytes =
    midiBytes instanceof Uint8Array ? midiBytes : new Uint8Array(midiBytes);
  const midi = parseMidi(bytes);
  const ticksPerBeat = midi.header.ticksPerBeat ?? 480;

  const track = findDrumTrack(midi.tracks);

  const notes: HopcatNote[] = [];
  const events: HopcatTextEvent[] = [];
  // pitch -> FIFO queue of open (startTick, velocity).
  const openByPitch = new Map<number, {start: number; vel: number}[]>();
  let t = 0;
  let maxTick = 0;
  for (const ev of track) {
    t += ev.deltaTime;
    if (t > maxTick) maxTick = t;
    if (ev.type === 'noteOn' && ev.velocity > 0) {
      let queue = openByPitch.get(ev.noteNumber);
      if (queue === undefined) {
        queue = [];
        openByPitch.set(ev.noteNumber, queue);
      }
      queue.push({start: t, vel: ev.velocity});
    } else if (isNoteOff(ev)) {
      const note = ev as {noteNumber: number};
      const queue = openByPitch.get(note.noteNumber);
      if (queue !== undefined && queue.length > 0) {
        const opened = queue.shift()!;
        notes.push({
          pos: opened.start,
          pitch: note.noteNumber,
          vel: opened.vel,
          dur: t - opened.start,
        });
      }
    } else if (
      ev.type === 'text' ||
      ev.type === 'marker' ||
      ev.type === 'lyrics'
    ) {
      if (ev.text) events.push({pos: t, text: ev.text});
    }
  }

  const tsEvents = timeSignatures(midi.tracks);
  const measureMap = buildMeasures(tsEvents, ticksPerBeat, maxTick);

  return {
    notes,
    events,
    measureMap,
    ticksPerBeat,
    hadTimeSignature: tsEvents.length > 0,
  };
}
