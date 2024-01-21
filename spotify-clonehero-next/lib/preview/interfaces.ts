type TickEvent = {
  tick: number;
};

type TimeSignature = TickEvent & {
  type: 'TS';
  numerator: number;
  denominator?: number;
};

export type BPM = TickEvent & {
  type: 'B';
  bpm: number;
  duration?: number;
};

export type SyncTrackEntry = TimeSignature | BPM;

export type Song = {
  Name: string;
  Artist: string;
  Charter: string;
  Album: string;
  Year: string;
  Offset: number;
  Resolution: number;
  Player2: string;
  Difficulty: number;
  PreviewStart: number;
  PreviewEnd: number;
  Genre: string;
  MediaType: string;
  MusicStream: string;
};

export type NoteEvent = TickEvent & {
  type: 'N';
  fret: number;
  length: number;
  time?: number;
  step?: number;
  duration?: number;
  hopo?: boolean;
};

export type ChartFile = {
  song?: Song;
  syncTrack?: Array<SyncTrackEntry>;
  expertSingle?: Array<NoteEvent>;
};
