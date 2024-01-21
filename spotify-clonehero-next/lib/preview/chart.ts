type TickEvent = {
  tick: number;
};

type TimeSignature = TickEvent & {
  type: "TS";
  numerator: number;
  denominator?: number;
};

type BPM = TickEvent & {
  type: "B";
  bpm: number;
  duration?: number;
};

type SyncTrackEntry = TimeSignature | BPM;

type Song = {
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
  type: "N";
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

export const parseChart = (chartData: string) => {
  const chart: ChartFile = {};

  const lines = chartData
    .split("\r\n")
    .map(line => line.trim())
    .filter(line => line.length !== 0);

  const processSong = (lines: Array<string>) => {
    const song: any = {};

    for (const kvpair of lines) {
      const [key, valueRaw] = kvpair.split("=").map(side => side.trim());

      let value: string | number = valueRaw;

      const num = parseInt(value);
      if (!isNaN(num)) {
        value = num;
      } else if (valueRaw.startsWith('"') && valueRaw.endsWith('"')) {
        value = valueRaw.slice(1, valueRaw.length - 1);
      }

      song[key] = value;
    }

    return song as Song;
  };

  const processSyncTrack = (lines: Array<string>) => {
    const syncTrack: Array<SyncTrackEntry> = [];

    for (const kvpair of lines) {
      const [key, valueRaw] = kvpair.split("=").map(side => side.trim());

      const tick = parseInt(key);
      const parts = valueRaw.split(" ");

      if (valueRaw.startsWith("B")) {
        syncTrack.push({
          tick,
          type: "B",
          bpm: parseInt(parts[1]),
        });
      } else if (valueRaw.startsWith("TS")) {
        const numerator = parseInt(parts[1]);
        const denominator = parts.length > 2 ? parseInt(parts[2]) : undefined;

        syncTrack.push({
          tick,
          type: "TS",
          numerator,
          denominator,
        });
      }
    }

    return syncTrack;
  };

  const processTrack = (lines: Array<string>) => {
    const track: Array<NoteEvent> = [];

    for (const kvpair of lines) {
      const [key, valueRaw] = kvpair.split("=").map(side => side.trim());

      const tick = parseInt(key);
      const parts = valueRaw.split(" ");

      if (valueRaw.startsWith("N")) {
        track.push({
          tick,
          type: "N",
          fret: parseInt(parts[1]),
          length: parseInt(parts[2]),
        });
      }
    }

    return track;
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (line.startsWith("[") && line.endsWith("]")) {
      const sectionName = line.slice(1, line.length - 1).toLowerCase();

      if (lines[i + 1] !== "{") {
        throw new Error(
          `Could not find opening bracket for section ${sectionName}`
        );
      }

      const sectionLines = lines.slice(i + 2, lines.indexOf("}", i + 2));

      switch (sectionName) {
        case "song": {
          chart.song = processSong(sectionLines);
          break;
        }
        case "synctrack": {
          chart.syncTrack = processSyncTrack(sectionLines);
          break;
        }
        case "expertsingle": {
          chart.expertSingle = processTrack(sectionLines);
          break;
        }
      }
    }
  }

  return chart;
};

export const calculateTimes = (chart: ChartFile) => {
  if (!chart.song) return;
  if (!chart.expertSingle) return;
  if (!chart.syncTrack) return;

  /**
   * make sure bpms are sorted in the correct order by tick
   * (idk if it ever wouldn't be)
   */

  const bpms = chart.syncTrack.filter(entry => entry.type == "B") as Array<BPM>;
  // console.log(bpms.length);
  for (let i = 0; i < bpms.length; i++) {
    if (i == bpms.length - 1) break;

    // console.log('setting duration');

    const bpm = bpms[i].bpm / 1000;

    bpms[i].duration =
      (((bpms[i + 1].tick - bpms[i].tick) / chart.song.Resolution) * 60) / bpm;
  }

  const tickTable: Record<number, number> = {};

  // const ticks = new Set();

  // for (const event of chart.expertSingle) {
  //   ticks.add(event.tick);
  // }

  for (let i = 0; i < chart.expertSingle.length; i++) {
    const note = chart.expertSingle[i];

    const bpmEntries = chart.syncTrack.filter(
      entry => entry.type == "B" && entry.tick <= note.tick
    ) as Array<BPM>;
    const currentBpmEntry = bpmEntries[bpmEntries.length - 1];

    const previousBpms = chart.syncTrack.filter(
      entry => entry.type === "B" && entry.tick < currentBpmEntry.tick
    ) as Array<BPM>;

    const durationUpTo = previousBpms.reduce(
      (sum, entry) => sum + entry.duration!,
      0
    );

    const bpm = currentBpmEntry.bpm / 1000;

    const time =
      durationUpTo +
      (((note.tick - currentBpmEntry.tick) / chart.song.Resolution) * 60) / bpm;

    note.time = time;

    tickTable[note.tick] = time;
  }

  for (let i = 0; i < chart.expertSingle.length; i++) {
    const note = chart.expertSingle[i];

    if (note.fret === 5) continue;

    const bpmEntries = chart.syncTrack.filter(
      entry => entry.type == "B" && entry.tick <= note.tick
    ) as Array<BPM>;
    const currentBpmEntry = bpmEntries[bpmEntries.length - 1];
    const bpm = currentBpmEntry.bpm / 1000;

    const time = note.time!;

    // step is .25 seconds
    // bpm is 120
    // step should be .5 or 1/2
    // note.step = (time - previousTime) / (60 / bpm) / 4;
    // console.log("tick - step", note.tick, note.step);
    // console.log(
    //   `tick:fret:previousTime:time`,
    //   note.tick,
    //   note.fret,
    //   previousTime,
    //   time
    // );

    let previousFrets: Array<number> = [];

    //chart.expertSingle[j].tick

    let j = i;
    while (j >= 0) {
      if (chart.expertSingle[j].tick < note.tick) {
        note.step =
          (time - tickTable[chart.expertSingle[j].tick]) / (60 / bpm) / 4;

        previousFrets = chart.expertSingle
          .filter(
            event =>
              event.type === "N" &&
              event.tick == chart.expertSingle![j].tick &&
              event.fret <= 4
          )
          .map(event => event.fret);

        break;
      }

      j--;
    }

    if (note.step) {
      if (
        (previousFrets.length > 1 || previousFrets[0] !== note.fret) &&
        note.step !== 0 &&
        note.step < 0.124999999 &&
        chart.expertSingle.filter(
          x => x.tick === note.tick && x.fret >= 0 && x.fret <= 4
        ).length === 1
      ) {
        note.hopo = true;

        const forced =
          chart.expertSingle.findIndex(
            x => x.tick === note.tick && x.fret === 5
          ) !== -1;

        if (forced) note.hopo = !note.hopo;
      }
    }

    note.time = time;

    note.duration = ((note.length / chart.song.Resolution) * 60) / bpm;
  }

  // for (const note of chart.expertSingle) {
  //   if (note.fret == 5) {
  //     const markNotes = chart.expertSingle.filter(
  //       markNote =>
  //         markNote.tick === note.tick &&
  //         markNote.fret <= 4 &&
  //         markNote.fret >= 0
  //     );
  //     for (const markNote of markNotes) {
  //       markNote.hopo = markNote.hopo === true ? false : true;
  //     }
  //   }
  // }
};

// const main = async () => {
//   const res = await fetch("/notes.chart");
//   const text = await res.text();
//   const chart = parseChart(text);
//   console.log(chart);
//   calculateTimes(chart);
// };

// main();
