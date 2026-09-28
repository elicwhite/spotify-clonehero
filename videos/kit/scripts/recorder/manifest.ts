/**
 * A take's manifest.json: the fields every recording has (src/recorder's
 * `RecordingManifest`), plus whatever an app adapter adds.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {Rect} from '../../src/motion';
import type {
  Interaction,
  RecordingManifest,
  SongTimeMap,
} from '../../src/recorder/manifest';

/** A box rounded to hundredths of a CSS px. */
export const roundBox = (b: Rect): Rect => ({
  x: +b.x.toFixed(2),
  y: +b.y.toFixed(2),
  width: +b.width.toFixed(2),
  height: +b.height.toFixed(2),
});

/** The smallest component box containing the pointer, else 'window'. */
export const overComponent = (
  cursor: {x: number; y: number},
  components: Record<string, Rect | null>,
): string => {
  let best: {name: string; area: number} | null = null;
  for (const [name, b] of Object.entries(components)) {
    if (!b || name === 'window') continue;
    if (
      cursor.x >= b.x &&
      cursor.x < b.x + b.width &&
      cursor.y >= b.y &&
      cursor.y < b.y + b.height
    ) {
      if (!best || b.width * b.height < best.area)
        best = {name, area: b.width * b.height};
    }
  }
  return best ? best.name : 'window';
};

/**
 * Song time of a film frame: its song second, the segment of the edit that
 * plays it, and whether the take pins that segment (plays its mapping on
 * past its ends) instead of following the edit.
 */
export type SongAt = (frame: number) => {
  songSec: number;
  segment: number;
  pinned: boolean;
};

/**
 * Song seconds per film frame over [from, to], one range per segment of the
 * film's edit (a pinned take: one range for its segment).
 */
export const songTimeRanges = (
  songAt: SongAt,
  from: number,
  to: number,
  fps: number,
): SongTimeMap => {
  const ranges: SongTimeMap['ranges'] = [];
  for (let f = from; f <= to; f++) {
    const {songSec, segment, pinned} = songAt(f);
    const last = ranges[ranges.length - 1];
    if (!last || last.segment !== segment || last.pinned !== pinned) {
      ranges.push({
        segment,
        pinned,
        fromFrame: f,
        toFrame: f,
        songSecAtFromFrame: +songSec.toFixed(6),
      });
    } else last.toFrame = f;
  }
  return {
    formula: `songSec = songSecAtFromFrame + (frame - fromFrame) / ${fps} inside each range`,
    ranges,
  };
};

/** A component video of a take: its box (CSS px) and device-pixel crop. */
export interface TakeOutput {
  name: string;
  box: Rect;
  crop: Rect;
}

/** The manifest of a take; `extra` holds the app adapter's own fields. */
export const buildManifest = ({
  id,
  app,
  description,
  fps,
  viewport,
  from,
  to,
  songAt = null,
  outputs,
  interactions,
  frames,
  encoding,
  pageErrors,
  extra = {},
}: {
  id: string;
  app: string;
  description: string;
  fps: number;
  viewport: {width: number; height: number; scale: number};
  from: number;
  to: number;
  songAt?: SongAt | null;
  outputs: readonly TakeOutput[];
  interactions: Interaction[];
  frames: RecordingManifest['frames'];
  encoding: RecordingManifest['encoding'];
  pageErrors: readonly string[];
  extra?: Record<string, unknown>;
}): RecordingManifest & Record<string, unknown> => ({
  version: 1,
  id,
  app,
  description,
  fps,
  viewport: {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.scale,
  },
  range: {from, to, count: to - from + 1},
  ...(songAt ? {songTime: songTimeRanges(songAt, from, to, fps)} : {}),
  components: Object.fromEntries(
    outputs.map(o => [
      o.name,
      {
        box: roundBox(o.box),
        crop: o.crop,
        file: `${o.name}.mp4`,
        width: o.crop.width,
        height: o.crop.height,
      },
    ]),
  ),
  interactions,
  ...extra,
  frames,
  encoding,
  pageErrors: pageErrors.slice(0, 20),
  recordedAt: new Date().toISOString(),
});

export const writeManifest = (dir: string, manifest: object): void => {
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(manifest, null, 1),
  );
};
