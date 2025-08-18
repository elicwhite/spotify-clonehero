declare module 'midifile' {
  import {EventType, MIDIEvent, SubEventType} from 'midievents';

  class MIDIFileHeader {
    /* eslint-disable @typescript-eslint/naming-convention */
    readonly HEADER_LENGTH = 14;
    readonly FRAMES_PER_SECONDS = 1;
    readonly TICKS_PER_BEAT = 2;
    /* eslint-enable @typescript-eslint/naming-convention */

    datas: DataView;

    constructor(buffer?: ArrayBufferLike, strictMode?: boolean);

    /** @returns the midi's format. */
    getFormat(): 0 | 1 | 2;

    setFormat(format: 0 | 1 | 2): void;

    /** @returns the number of tracks in the midi file. */
    getTracksCount(): number;

    setTracksCount(count: number): void;

    /**
     * @param tempo in units of microseconds per quarter note.
     * @returns the tick resolution in microseconds per tick.
     */
    getTickResolution(tempo?: number): number;

    /** @returns the format of the midi file's resolution */
    getTimeDivision(): typeof FRAMES_PER_SECONDS | typeof TICKS_PER_BEAT;

    /**
     * @throws an exception if resolution is not measured in ticks per quarter note.
     * @returns the resolution in ticks per quarter note.
     */
    getTicksPerBeat(): number;

    setTicksPerBeat(ticksPerBeat: number): void;

    /**
     * @throws an exception if resolution is not measured in ticks per SMPTE frame.
     * @returns the number of SMPTE frames per second.
     */
    getSMPTEFrames(): 24 | 25 | 29.97 | 30;

    /**
     * @throws an exception if resolution is not measured in ticks per SMPTE frame.
     * @returns the resolution number measured in ticks per SMPTE frame.
     */
    getTicksPerFrame(): number;

    setSMTPEDivision(
      smpteFrames: 24 | 25 | 29.97 | 30,
      ticksPerFrame: number,
    ): void;
  }

  class MIDIFileTrack {
    /* eslint-disable @typescript-eslint/naming-convention */
    readonly HDR_LENGTH = 8;
    /* eslint-enable @typescript-eslint/naming-convention */

    datas: DataView;

    constructor(buffer?: ArrayBufferLike, start?: number, strictMode?: boolean);

    getTrackLength(): number;

    setTrackLength(trackLength: number): void;

    /** Get a `DataView` that references the content of the track. */
    getTrackContent(): DataView;

    setTrackContent(dataView: DataView): void;
  }

  class MIDIFile {
    /* eslint-disable @typescript-eslint/naming-convention */
    static Header = MIDIFileHeader;
    static Track = MIDIFileTrack;
    /* eslint-enable @typescript-eslint/naming-convention */

    header: MIDIFileHeader;
    tracks: MIDIFileTrack[];

    /**
     * @param buffer A buffer containing the MIDI data. Pass `null` to create a new MIDI file.
     * @param strictMode Set to true if an exception should be thrown if `buffer` is poorly formatted.
     */
    constructor(buffer: ArrayBuffer | Uint8Array | null, strictMode?: boolean);

    /**
     * @param type the midi event type to select.
     * @param subtype the midi event subtype to select.
     * @returns the list of MIDIEvents in `buffer`. If `type` or `subtype` are defined,
     * the list is filtered to only include events with that type or subtype.
     */
    getEvents(type?: EventType, subtype?: SubEventType): MIDIEvent[];

    /** The same as `this.getEvents(EVENT_MIDI)`. */
    getMidiEvents(): MIDIEvent[];

    /**
     * @returns the list of MIDIEvents that either the EVENT_META_LYRICS or EVENT_META_TEXT subtype.
     * `MIDIEvent.text` has been set to the string representation of `data`, assuming the encoding is UTF-8.
     */
    getLyrics(): MIDIEvent[];

    /** @returns the list of MIDIEvents that belong to the track with index `index`. */
    getTrackEvents(index: number): MIDIEvent[];

    setTrackEvents(index: number, events: MIDIEvent[]): void;

    /** Removes the track with index `index` from the midi file. */
    deleteTrack(index: number): void;

    /** Adds a new empty track to the midi file. */
    addTrack(index: number);

    /** @returns a copy of `buffer`. */
    getContent(): ArrayBufferLike;
  }

  export = MIDIFile;
}
