declare module 'midievents' {
  // Event types
  const EVENT_META = 0xff;
  const EVENT_SYSEX = 0xf0;
  const EVENT_DIVSYSEX = 0xf7;
  const EVENT_MIDI = 0x8;
  type EventType =
    | typeof EVENT_META
    | typeof EVENT_SYSEX
    | typeof EVENT_DIVSYSEX
    | typeof EVENT_MIDI;

  // Meta event types
  const EVENT_META_SEQUENCE_NUMBER = 0x00;
  const EVENT_META_TEXT = 0x01;
  const EVENT_META_COPYRIGHT_NOTICE = 0x02;
  const EVENT_META_TRACK_NAME = 0x03;
  const EVENT_META_INSTRUMENT_NAME = 0x04;
  const EVENT_META_LYRICS = 0x05;
  const EVENT_META_MARKER = 0x06;
  const EVENT_META_CUE_POINT = 0x07;
  const EVENT_META_MIDI_CHANNEL_PREFIX = 0x20;
  const EVENT_META_END_OF_TRACK = 0x2f;
  const EVENT_META_SET_TEMPO = 0x51;
  const EVENT_META_SMTPE_OFFSET = 0x54;
  const EVENT_META_TIME_SIGNATURE = 0x58;
  const EVENT_META_KEY_SIGNATURE = 0x59;
  const EVENT_META_SEQUENCER_SPECIFIC = 0x7f;
  type MetaEventSubtype =
    | typeof EVENT_META_SEQUENCE_NUMBER
    | typeof EVENT_META_TEXT
    | typeof EVENT_META_COPYRIGHT_NOTICE
    | typeof EVENT_META_TRACK_NAME
    | typeof EVENT_META_INSTRUMENT_NAME
    | typeof EVENT_META_LYRICS
    | typeof EVENT_META_MARKER
    | typeof EVENT_META_CUE_POINT
    | typeof EVENT_META_MIDI_CHANNEL_PREFIX
    | typeof EVENT_META_END_OF_TRACK
    | typeof EVENT_META_SET_TEMPO
    | typeof EVENT_META_SMTPE_OFFSET
    | typeof EVENT_META_TIME_SIGNATURE
    | typeof EVENT_META_KEY_SIGNATURE
    | typeof EVENT_META_SEQUENCER_SPECIFIC;

  // MIDI event types
  const EVENT_MIDI_NOTE_OFF = 0x8;
  const EVENT_MIDI_NOTE_ON = 0x9;
  const EVENT_MIDI_NOTE_AFTERTOUCH = 0xa;
  const EVENT_MIDI_CONTROLLER = 0xb;
  const EVENT_MIDI_PROGRAM_CHANGE = 0xc;
  const EVENT_MIDI_CHANNEL_AFTERTOUCH = 0xd;
  const EVENT_MIDI_PITCH_BEND = 0xe;
  type MIDIEventSubtype =
    | typeof EVENT_MIDI_NOTE_OFF
    | typeof EVENT_MIDI_NOTE_ON
    | typeof EVENT_MIDI_NOTE_AFTERTOUCH
    | typeof EVENT_MIDI_CONTROLLER
    | typeof EVENT_MIDI_PROGRAM_CHANGE
    | typeof EVENT_MIDI_CHANNEL_AFTERTOUCH
    | typeof EVENT_MIDI_PITCH_BEND;

  // MIDI event sizes
  const MIDI_1PARAM_EVENTS = [
    EVENT_MIDI_PROGRAM_CHANGE,
    EVENT_MIDI_CHANNEL_AFTERTOUCH,
  ];
  const MIDI_2PARAMS_EVENTS = [
    EVENT_MIDI_NOTE_OFF,
    EVENT_MIDI_NOTE_ON,
    EVENT_MIDI_NOTE_AFTERTOUCH,
    EVENT_MIDI_CONTROLLER,
    EVENT_MIDI_PITCH_BEND,
  ];

  type SubEventType = MetaEventSubtype | MIDIEventSubtype;
  interface MIDIEvent {
    /** A string of a hexidecimal number for the event's byte index in the MIDI buffer. */
    index: string;

    /**
     * The index of the track that contains this event.
     *
     * If `MIDIFileHeader.getFormat !== 1` or there is a single track, this is undefined.
     *
     * If `MIDIFile.getEvents()` or `MIDIFile.getMidiEvents()` were not called to get this event, this is undefined.
     */
    track?: number;

    /** The number of ticks between this event and the previous event (or the track start if there was no previous event). */
    delta: number;

    /**
     * The time of the event in milliseconds since the start of the track. If `MIDIFileHeader.getFormat === 2`,
     * this is the time since the start of the first track.
     *
     * If `MIDIFile.getEvents()` or `MIDIFile.getMidiEvents()` were not called to get this event, this is undefined.
     */
    playTime?: number;

    /**
     * The MIDI Event Type. Known types are META, SYSEX, DIVSYSEX, and MIDI.
     * If there is an unknown event type, it will be some other unexpected number.
     */
    type: EventType;

    /**
     * The MIDI Event's Subtype. What values this can be depend on what `type` is.
     * If there is an unknown event subtype, it will be some other unexpected number.
     */
    subtype: SubEventType;

    /** If this is defined, it means the other event properties are not parsed correctly. */
    badsubtype?: number;

    /**
     * For META events, this is the number of bytes in `data`.
     *
     * For SYSEX and DIVSYSEX events, this is the number of bytes in `data`.
     */
    length: number;

    /**
     * An array of bytes that describe the event Text is typically in ASCII.
     *
     * For the META_TEXT subtype, this is the event text.
     *
     * For the META_COPYRIGHT_NOTICE subtype, this is the copywright notice text.
     *
     * For the META_TRACK_NAME subtype, this is the track's name.
     *
     * For the META_INSTRUMENT_NAME subtype, this is a description of the instrumentation.
     *
     * For the META_LYRICS subtype, this is the lyric text at the event. (typically one syllable)
     *
     * For the META_MARKER subtype, this is the meta marker text.
     *
     * For the META_CUE_POINT subtype, this describes an event happening at this point in an accompanying media.
     *
     * For the META_TIME_SIGNATURE subtype, this is the time signature. `data[0]` is the numerator. `data[1]` is
     * the power-of-2 exponent for the denominator. `data[2]` is the number of MIDI clocks in a metronome click.
     * `data[3]` is the number of notated 32nd notes per MIDI quarter note. If the time signature isn't specified,
     * it can be assumed to be 4/4.
     *
     * For the META_SEQUENCER_SPECIFIC subtype, this is the data of the sequencer-specific event.
     *
     * For SYSEX and DIVSYSEX events, this is the system-exclusive event data.
     * Note that for SYSEX events, An additional 0xF7 is appended to the end.
     *
     * For other subtypes, this is the remaining `length` bytes of the event.
     */
    data: number[];

    /**
     * For the EVENT_META_SEQUENCE_NUMBER subtype, this is the most significant byte of the sequence number.
     *
     * For other subtypes, this is undefined.
     */
    msb?: number;

    /**
     * For the EVENT_META_SEQUENCE_NUMBER subtype, this is the least significant byte of the sequence number.
     *
     * For other subtypes, this is undefined.
     */
    lsb?: number;

    /**
     * For the META_MIDI_CHANNEL_PREFIX subtype, this is the channel number (0-15).
     *
     * For other subtypes, this is undefined.
     */
    prefix?: number;

    /**
     * For the META_SET_TEMPO subtype, this is the tempo in units of microseconds per quarter note.
     * (If the tempo is never specified it can be assumed to be 500000)
     *
     * For other subtypes, this is undefined.
     */
    tempo?: number;

    /**
     * For the META_SET_TEMPO subtype, this is the tempo in units of beats per minute.
     * (If the tempo is never specified it can be assumed to be 120)
     *
     * For other subtypes, this is undefined.
     */
    tempoBPM?: number;

    /**
     * For the META_SMTPE_OFFSET subtype, this is the SMPTE hour that a track should start at.
     *
     * For other subtypes, this is undefined.
     */
    hour?: number;

    /**
     * For the META_SMTPE_OFFSET subtype, this is the SMPTE minute that a track should start at.
     *
     * For other subtypes, this is undefined.
     */
    minutes?: number;

    /**
     * For the META_SMTPE_OFFSET subtype, this is the SMPTE second that a track should start at.
     *
     * For other subtypes, this is undefined.
     */
    seconds?: number;

    /**
     * For the META_SMTPE_OFFSET subtype, this is the SMPTE frame that a track should start at.
     *
     * For other subtypes, this is undefined.
     */
    frames?: number;

    /**
     * For the META_SMTPE_OFFSET subtype, this is the SMPTE subframe that a track should start at.
     * (fractional frame in 1/100ths of a frame)
     *
     * For other subtypes, this is undefined.
     */
    subframes?: number;

    /**
     * For the META_KEY_SIGNATURE subtype, this is the number of sharps or flats
     * from -7 to 7 (positive is sharps, negative is flats, 0 is none).
     *
     * For other subtypes, this is undefined.
     */
    key?: number;

    /**
     * For the META_KEY_SIGNATURE subtype, this is 0 for major, 1 for minor.
     *
     * For other subtypes, this is undefined.
     */
    scale?: number;

    /**
     * For MIDI events, this is the event's channel. (0-15)
     *
     * For other subtypes, this is undefined.
     */
    channel?: number;

    /**
     * This value is derived from a single byte. (0-127)
     *
     * For the META_TIME_SIGNATURE subtye, this is the numerator.
     *
     * For the MIDI_NOTE_OFF subtype, this is the note number/position.
     *
     * For the MIDI_NOTE_ON subtype, this is the note number/position.
     *
     * For the MIDI_NOTE_AFTERTOUCH subtype, this is the note number/position.
     *
     * For the MIDI_CONTROLLER subtype, this is the controller number.
     *
     * For the MIDI_PROGRAM_CHANGE subtype, this is the program number.
     *
     * For the MIDI_CHANNEL_AFTERTOUCH subtype, this is the pressure.
     *
     * For the MIDI_PITCH_BEND subtype, this is the least significant byte of the pitch bend value.
     *
     * For other subtypes, this is undefined.
     */
    param1?: number;

    /**
     * This value is derived from a single byte. (0-127)
     *
     * For the META_TIME_SIGNATURE subtye, this is the power-of-2 exponent for the denominator.
     *
     * For the MIDI_NOTE_OFF subtype, this is the note's velocity.
     *
     * For the MIDI_NOTE_ON subtype, this is the note's velocity.
     *
     * For the MIDI_NOTE_AFTERTOUCH subtype, this is the pressure of the note.
     *
     * For the MIDI_CONTROLLER subtype, this is the control value.
     *
     * For the MIDI_PITCH_BEND subtype, this is the most significant byte of the pitch bend value.
     *
     * For other subtypes, this is undefined.
     */
    param2?: number;

    /**
     * For the META_TIME_SIGNATURE subtye, this is the number of MIDI clocks in a metronome click.
     *
     * For other subtypes, this is undefined.
     */
    param3?: number;

    /**
     * For the META_TIME_SIGNATURE subtye, this is the number of notated 32nd notes per MIDI quarter note.
     *
     * For other subtypes, this is undefined.
     */
    param4?: number;

    /**
     * For the EVENT_META_LYRICS and EVENT_META_TEXT subtype, this is the string representation of `data`,
     * assuming the encoding is UTF-8.
     *
     * For other subtypes, this is undefined.
     *
     * If `MIDIFile.getLyrics()` was not called to get this event, this is undefined.
     */
    text?: string;
  }

  interface MIDIParser {
    next: () => MIDIEvent | null;
  }

  function createParser(
    stream: DataView,
    startAt: number,
    strictMode: boolean,
  ): MIDIParser;

  function writeToTrack(
    events: MIDIEvent[],
    destination: Uint8Array,
    strictMode: boolean,
  ): void;

  function getRequiredBufferLength(events: MIDIEvent[]): number;
}
