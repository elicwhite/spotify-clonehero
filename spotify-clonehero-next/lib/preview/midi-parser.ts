import {
  Difficulty,
  EventType,
  Instrument,
  NotesData,
  TrackEvent,
} from 'scan-chart-web';
import MIDIFile from 'midifile';
import {
  EVENT_DIVSYSEX,
  EVENT_META,
  EVENT_META_END_OF_TRACK,
  EVENT_META_LYRICS,
  EVENT_META_SET_TEMPO,
  EVENT_META_TEXT,
  EVENT_META_TIME_SIGNATURE,
  EVENT_META_TRACK_NAME,
  EVENT_MIDI,
  EVENT_MIDI_NOTE_ON,
  EVENT_SYSEX,
  MIDIEvent,
} from 'midievents';
import * as _ from 'lodash';
import {TrackParser} from './track-parser';

type TrackName = InstrumentName | 'PART VOCALS' | 'EVENTS';
type InstrumentName = keyof typeof instrumentNameMap;
const instrumentNameMap = {
  'PART GUITAR': 'guitar',
  'PART GUITAR COOP': 'guitarcoop',
  'PART RHYTHM': 'rhythm',
  'PART BASS': 'bass',
  'PART DRUMS': 'drums',
  'PART KEYS': 'keys',
  'PART GUITAR GHL': 'guitarghl',
  'PART GUITAR COOP GHL': 'guitarcoopghl',
  'PART RHYTHM GHL': 'rhythmghl',
  'PART BASS GHL': 'bassghl',
} as const;

const sysExDifficultyMap = ['easy', 'medium', 'hard', 'expert'] as const;
const fiveFretDiffStarts = {easy: 59, medium: 71, hard: 83, expert: 95};
const sixFretDiffStarts = {easy: 58, medium: 70, hard: 82, expert: 94};
const drumsDiffStarts = {easy: 60, medium: 72, hard: 84, expert: 96};

interface TrackEventEnd {
  difficulty: Difficulty | null;
  time: number;
  type: EventType | null;
  isStart: boolean;
}
interface TrackEventDiff extends TrackEvent {
  difficulty: Difficulty | null;
}

export class MidiParser {
  public notesData: NotesData;
  public tempoMap: MIDIEvent[] = [];
  public timeSignatures: MIDIEvent[] = [];
  public tracks: {
    trackIndex: number;
    trackName: TrackName;
    trackEvents: MIDIEvent[];
  }[];
  public splitTracks: {
    instrument: Instrument;
    difficulty: Difficulty;
    trackEvents: TrackEvent[];
  }[];
  public trackParsers: TrackParser[] = [];

  constructor(midiFile: MIDIFile) {
    this.notesData = {
      instruments: [],
      drumType: null,
      hasSoloSections: false,
      hasLyrics: false,
      hasVocals: false,
      hasForcedNotes: false,
      hasTapNotes: false,
      hasOpenNotes: false,
      has2xKick: false,
      hasRollLanes: false,
      noteIssues: [],
      trackIssues: [],
      chartIssues: [],
      noteCounts: [],
      maxNps: [],
      hashes: [],
      tempoMapHash: '',
      tempoMarkerCount: 0,
      length: 0,
      effectiveLength: 0,
    };

    const trackNameEvents: MIDIEvent[] = [];
    const trackEvents: MIDIEvent[][] = [];

    const allEvents = midiFile.getEvents();
    for (const midiEvent of allEvents) {
      midiEvent.playTime = _.round(midiEvent.playTime ?? -1, 3);

      switch (midiEvent.type) {
        case EVENT_META: {
          switch (midiEvent.subtype) {
            case EVENT_META_TRACK_NAME:
              if (midiEvent.playTime === 0) {
                trackNameEvents.push(midiEvent);
              }
              break;
            case EVENT_META_SET_TEMPO:
              this.tempoMap.push(midiEvent);
              break;
            case EVENT_META_TIME_SIGNATURE:
              this.timeSignatures.push(midiEvent);
              break;
            case EVENT_META_LYRICS:
              break; // Ignored
            case EVENT_META_END_OF_TRACK:
              break; // Ignored
            case EVENT_META_TEXT: {
              (trackEvents[midiEvent.track!] ??= []).push(midiEvent);
              break;
            }
          }
          break;
        }
        case EVENT_SYSEX:
        case EVENT_DIVSYSEX: {
          (trackEvents[midiEvent.track!] ??= []).push(midiEvent);
          break;
        }
        case EVENT_MIDI: {
          (trackEvents[midiEvent.track!] ??= []).push(midiEvent);
          break;
        }
      }
    }

    if (this.tempoMap.length === 0) {
      this.tracks = [];
      this.splitTracks = [];
      this.notesData.chartIssues.push('noSyncTrackSection');
      return;
    }

    this.tracks = trackNameEvents.map(event => ({
      trackIndex: event.track!,
      trackName: event.data
        .map(dta => String.fromCharCode(dta))
        .join('')
        .trim() as TrackName,
      trackEvents: trackEvents[event.track!],
    }));

    this.splitTracks = _.chain(this.tracks)
      .filter(t => _.keys(instrumentNameMap).includes(t.trackName))
      .map(t => {
        const instrument = instrumentNameMap[t.trackName as InstrumentName];
        const trackEventGroups = _.chain(t.trackEvents)
          .map(te => this.getTrackEventEnds(te, instrument))
          .filter(te => te.type !== null) // Discard unknown event types
          .groupBy(te => te.difficulty) // Global modifiers have a difficulty of `null`. `groupBy` sets this to 'null'
          .toPairs()
          .thru(groups => this.distributeGlobalModifiers(groups)) // Removes group for difficulty of `null`
          .map(
            ([difficulty, te]) =>
              [difficulty, this.getTrackEvents(te)] as [
                string,
                TrackEventDiff[],
              ],
          )
          .thru(te => this.applyAndRemoveModifiers(te))
          .value();

        return trackEventGroups.map(g => ({
          instrument,
          difficulty: g[0] as Difficulty,
          trackEvents: g[1],
        }));
      })
      .flatMap()
      .value();

    this.applyEventLengthFix();
  }

  private getTrackEventEnds(
    event: MIDIEvent,
    instrument: Instrument,
  ): TrackEventEnd {
    // SysEx event (tap modifier or open)
    const eventData = event.data?.map(dta => String.fromCharCode(dta)) ?? [];
    if (event.type === EVENT_SYSEX || event.type === EVENT_DIVSYSEX) {
      if (
        eventData[0] === 'P' &&
        eventData[1] === 'S' &&
        eventData[2] === '\0' &&
        event.data[3] === 0x00
      ) {
        // Phase Shift SysEx event
        return {
          difficulty:
            event.data[4] == 0xff ? null : sysExDifficultyMap[event.data[4]],
          time: event.playTime!,
          type:
            event.data[5] === 0x01
              ? EventType.open
              : event.data[5] === 0x04
              ? EventType.tap
              : null,
          isStart: event.data[6] === 0x01,
        };
      }
    }

    const note = event.param1!;
    const difficulty =
      note <= 66
        ? 'easy'
        : note <= 78
        ? 'medium'
        : note <= 90
        ? 'hard'
        : note <= 102
        ? 'expert'
        : null;
    // Instrument event (solo marker, star power, activation lane, roll lane) (applies to all difficulties)
    if (!difficulty) {
      return {
        difficulty,
        time: event.playTime!,
        type: this.getInstrumentEventType(note),
        isStart: event.subtype === EVENT_MIDI_NOTE_ON,
      };
    }

    return {
      difficulty,
      time: event.playTime!,
      type:
        (['guitarghl', 'guitarcoopghl', 'rhythmghl', 'bassghl'].includes(
          instrument,
        )
          ? this.get6FretNoteType(note, difficulty)
          : instrument === 'drums'
          ? this.getDrumsNoteType(note, difficulty)
          : this.get5FretNoteType(note, difficulty)) ?? null,
      isStart: event.subtype === EVENT_MIDI_NOTE_ON,
    };
  }

  private getInstrumentEventType(note: number) {
    switch (note) {
      case 103:
        return EventType.soloMarker;
      case 110:
        return EventType.yellowTomOrCymbalMarker;
      case 111:
        return EventType.blueTomOrCymbalMarker;
      case 112:
        return EventType.greenTomOrCymbalMarker;
      case 116:
        return EventType.starPower;
      case 120:
        return EventType.activationLane;
      case 121:
        return EventType.activationLane;
      case 122:
        return EventType.activationLane;
      case 123:
        return EventType.activationLane;
      case 124:
        return EventType.activationLane;
      case 126:
        return EventType.rollLaneSingle;
      case 127:
        return EventType.rollLaneDouble;
      default:
        return null;
    }
  }

  private get5FretNoteType(note: number, difficulty: Difficulty) {
    switch (note - fiveFretDiffStarts[difficulty]) {
      case 1:
        return EventType.green;
      case 2:
        return EventType.red;
      case 3:
        return EventType.yellow;
      case 4:
        return EventType.blue;
      case 5:
        return EventType.orange;
      case 6:
        return EventType.force; // Force HOPO
      case 7:
        return EventType.force; // Force strum
    }
  }

  private get6FretNoteType(note: number, difficulty: Difficulty) {
    switch (note - sixFretDiffStarts[difficulty]) {
      case 0:
        return EventType.open;
      case 1:
        return EventType.white1;
      case 2:
        return EventType.white2;
      case 3:
        return EventType.white3;
      case 4:
        return EventType.black1;
      case 5:
        return EventType.black2;
      case 6:
        return EventType.black3;
      case 7:
        return EventType.force; // Force HOPO
      case 8:
        return EventType.force; // Force strum
    }
  }

  private getDrumsNoteType(note: number, difficulty: Difficulty) {
    switch (note - drumsDiffStarts[difficulty]) {
      case -1:
        return EventType.kick2x;
      case 0:
        return EventType.kick;
      case 1:
        return EventType.red;
      case 2:
        return EventType.yellow;
      case 3:
        return EventType.blue;
      case 4:
        return EventType.orange;
      case 5:
        return EventType.green;
    }
  }

  /**
   * Any Sysex modifiers with difficulty 0xFF are meant to apply to all charted difficulties.
   * In `groups`, these have difficulty `'null'`.
   */
  private distributeGlobalModifiers(groups: [string, TrackEventEnd[]][]) {
    const globalModifiers =
      _.remove(groups, g => g[0] === 'null')[0]?.[1] ?? [];

    for (const modifier of globalModifiers) {
      for (const group of groups) {
        const difficultyModifier = _.clone(modifier);
        difficultyModifier.difficulty = group[0] as Difficulty;
        group[1].push(difficultyModifier);
      }
    }

    return groups;
  }

  /** Assumes `trackEventEnds` are all events belonging to the same instrument and difficulty. */
  private getTrackEvents(trackEventEnds: TrackEventEnd[]) {
    const trackEvents: TrackEventDiff[] = [];
    const lastTrackEventEnds: Partial<{[type in EventType]: TrackEventEnd}> =
      {};
    // Note: open, tap, and force are all "sustains" that mark notes under them as that type
    const zeroLengthEventTypes = [
      EventType.soloMarker,
      EventType.activationLane,
      EventType.kick,
      EventType.kick2x,
    ];

    for (const trackEventEnd of trackEventEnds) {
      const lastTrackEventEnd = lastTrackEventEnds[trackEventEnd.type!];
      if (trackEventEnd.isStart) {
        if (zeroLengthEventTypes.includes(trackEventEnd.type!)) {
          trackEvents.push({
            difficulty: trackEventEnd.difficulty!,
            time: trackEventEnd.time,
            length: 0,
            type: trackEventEnd.type!,
          });
        } else {
          lastTrackEventEnds[trackEventEnd.type!] = trackEventEnd;
        }
      } else if (lastTrackEventEnd) {
        trackEvents.push({
          difficulty: trackEventEnd.difficulty!,
          time: lastTrackEventEnd.time,
          length: _.round(trackEventEnd.time - lastTrackEventEnd.time, 3),
          type: lastTrackEventEnd.type!,
        });
        delete lastTrackEventEnds[trackEventEnd.type!];
      }
    }

    return _.sortBy(
      trackEvents,
      te => te.time,
      te => te.type,
    );
  }

  /** Any note that begins during a modifier "sustain" is converted to that type. (open, tap, force) */
  private applyAndRemoveModifiers(groups: [string, TrackEventDiff[]][]) {
    for (const group of groups) {
      const reducedTrackEventDiffs: TrackEventDiff[] = [];
      let [lastOpen, lastTap, lastForce] = [
        {time: -1, length: 0},
        {time: -1, length: 0},
        {time: -1, length: 0},
      ];
      let [lastTapMarkerTime, lastForceMarkerTime] = [-1, -1];

      for (const trackEventDiff of group[1]) {
        switch (trackEventDiff.type) {
          case EventType.open:
            lastOpen = trackEventDiff;
            continue;
          case EventType.tap:
            lastTap = trackEventDiff;
            continue;
          case EventType.force:
            lastForce = trackEventDiff;
            continue;
          case EventType.starPower:
            break;
          case EventType.soloMarker:
            break;
          case EventType.activationLane:
            break;
          case EventType.rollLaneSingle:
            break;
          case EventType.rollLaneDouble:
            break;
          default: {
            if (
              trackEventDiff.time >= lastOpen.time &&
              trackEventDiff.time < lastOpen.time + lastOpen.length
            ) {
              trackEventDiff.type = EventType.open;
            } else if (
              trackEventDiff.time >= lastTap.time &&
              trackEventDiff.time < lastTap.time + lastTap.length
            ) {
              if (lastTapMarkerTime !== trackEventDiff.time) {
                // Only create one tap marker per tick
                lastTapMarkerTime = trackEventDiff.time;
                reducedTrackEventDiffs.push({
                  difficulty: trackEventDiff.difficulty,
                  time: trackEventDiff.time,
                  length: 0,
                  type: EventType.tap,
                });
              }
            } else if (
              trackEventDiff.time >= lastForce.time &&
              trackEventDiff.time < lastForce.time + lastForce.length
            ) {
              if (lastForceMarkerTime !== trackEventDiff.time) {
                // Only create one force marker per tick
                lastForceMarkerTime = trackEventDiff.time;
                reducedTrackEventDiffs.push({
                  difficulty: trackEventDiff.difficulty,
                  time: trackEventDiff.time,
                  length: 0,
                  type: EventType.force,
                });
              }
            }
          }
        }
        reducedTrackEventDiffs.push(trackEventDiff);
      }

      group[1] = reducedTrackEventDiffs;
    }

    return groups;
  }

  /** Sustains shorter than a 1/12th step are cut off and turned into a normal (non-sustain) note. */
  private applyEventLengthFix() {
    const events = _.chain(this.splitTracks)
      .flatMap(st =>
        st.trackEvents.filter(
          te => te.length > 0 && te.type !== EventType.starPower,
        ),
      )
      .sortBy(te => te.time)
      .value();

    let currentBpmIndex = 0;
    for (const event of events) {
      while (
        this.tempoMap[currentBpmIndex + 1] &&
        this.tempoMap[currentBpmIndex + 1].playTime! <= event.time
      ) {
        currentBpmIndex++; // Increment currentBpmIndex to the index of the most recent BPM marker
      }

      // Assumes the BPM doesn't change across the duration of the sustain.
      // This will rarely happen, and will be incorrectly interpreted even less often.
      const lengthInTwelfthNotes =
        event.length * 1000 * (1 / this.tempoMap[currentBpmIndex].tempo!) * 3;
      if (lengthInTwelfthNotes < 1) {
        event.length = 0;
      }
    }
  }

  public parse(): MidiParser {
    const trackParsers = _.chain(this.splitTracks)
      .map(
        track =>
          new TrackParser(
            this.notesData,
            track.instrument,
            track.difficulty,
            track.trackEvents,
            'mid',
          ),
      )
      .value();

    trackParsers.forEach(p => p.parseTrack());
    this.trackParsers = trackParsers;

    const globalFirstNote =
      _.minBy(trackParsers, p => p.firstNote?.time ?? Infinity)?.firstNote ??
      null;
    const globalLastNote =
      _.maxBy(trackParsers, p => p.lastNote?.time ?? -Infinity)?.lastNote ??
      null;

    if (globalFirstNote === null || globalLastNote === null) {
      this.notesData.chartIssues.push('noNotes');
      return this;
    }

    const vocalEvents = this.tracks.find(t => t.trackName === 'PART VOCALS')
      ?.trackEvents;
    if (vocalEvents?.length) {
      this.notesData.hasLyrics = true;
      if (
        vocalEvents.find(
          te =>
            te.param1! !== 105 &&
            te.param1! !== 106 &&
            !(te.type === EVENT_META && te.subtype === EVENT_META_TEXT),
        )
      ) {
        this.notesData.hasVocals = true;
      }
    }
    const sectionEvents = _.chain(
      this.tracks.find(t => t.trackName === 'EVENTS')?.trackEvents ?? [],
    )
      .map(ete => ete.data?.map(dta => String.fromCharCode(dta)).join('') ?? '')
      .filter(name => name.includes('[section') || name.includes('[prc_'))
      .value();
    if (!sectionEvents.length) {
      this.notesData.chartIssues.push('noSections');
    }

    this.notesData.tempoMapHash = '';
    this.notesData.tempoMarkerCount = this.tempoMap.length;

    if (
      this.tempoMap.length === 1 &&
      _.round(this.tempoMap[0].tempoBPM!, 3) === 120 &&
      this.timeSignatures.length === 1
    ) {
      this.notesData.chartIssues.push('isDefaultBPM');
    }

    this.notesData.length = Math.floor(globalLastNote.time);
    this.notesData.effectiveLength = Math.floor(
      globalLastNote.time - globalFirstNote.time,
    );

    this.setMissingExperts();
    this.setTimeSignatureProperties();

    return this; //.notesData;
  }

  private setMissingExperts() {
    const missingExperts = _.chain(this.splitTracks)
      .groupBy(trackSection => trackSection.instrument)
      .mapValues(trackSections =>
        trackSections.map(trackSection => trackSection.difficulty),
      )
      .toPairs()
      .filter(
        ([, difficulties]) =>
          !difficulties.includes('expert') && difficulties.length > 0,
      )
      .map(([instrument]) => instrument as Instrument)
      .value();

    if (missingExperts.length > 0) {
      this.notesData.chartIssues.push('noExpert');
    }
  }

  private setTimeSignatureProperties() {
    const events = _.sortBy(
      [..._.drop(this.tempoMap, 1), ...this.timeSignatures],
      e => e.playTime,
    );
    const timeSignatures: (MIDIEvent & {tick: number})[] = [];
    let currentTempo = this.tempoMap[0].tempo!;
    const resolution = 480; // Arbitrarily chosen value for ticks in each quarter note
    let currentTick = 0;
    for (let i = 0; i < events.length; i++) {
      const deltaTimeMs = events[i].playTime! - (events[i - 1]?.playTime ?? 0);
      currentTick += deltaTimeMs * 1000 * (1 / currentTempo) * resolution;
      if (events[i].tempo) {
        currentTempo = events[i].tempo!;
      } else if (events[i].param1) {
        timeSignatures.push({...events[i], tick: _.round(currentTick)});
      }
    }

    let previousBeatlineTick = 0;
    for (let i = 0; i < timeSignatures.length; i++) {
      if (
        _.round(previousBeatlineTick, 5) !== _.round(timeSignatures[i].tick, 5)
      ) {
        this.notesData.chartIssues.push('misalignedTimeSignatures');
        break;
      }
      while (
        timeSignatures[i + 1] &&
        previousBeatlineTick < timeSignatures[i + 1].tick
      ) {
        const timeSignatureFraction =
          timeSignatures[i].param1! / Math.pow(2, timeSignatures[i].param2!);
        previousBeatlineTick += resolution * timeSignatureFraction * 4;
      }
    }
  }
}
