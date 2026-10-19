/**
 * The reduction graphs are shared by guitar and bass, so every user-facing
 * string the reducer emits has to name the instrument the run was started
 * for. `difficulty-worker.ts` surfaces these verbatim through
 * `{type:'progress', detail}` to the step row the user is watching.
 *
 * The ONNX runtime is mocked here: it fetches its models from a remote host
 * at call time, and the runtime's own load copy is deliberately instrument
 * neutral because a single memoized runtime serves every instrument.
 */

import fs from 'node:fs';
import path from 'node:path';
import {readChart} from '@/lib/chart-edit';
import type {Track} from '@/lib/preview/highway/types';
import {snapshotToChartText, type GuitarReductionSnapshot} from '../snapshot';
import {loadGuitarReductionRuntime, type GuitarReductionRuntime} from '../onnx';
import {reduceGuitarDifficulties} from '../reduce';

jest.mock('../onnx', () => ({
  loadGuitarReductionRuntime: jest.fn(),
}));

const mockedLoadRuntime = loadGuitarReductionRuntime as jest.MockedFunction<
  typeof loadGuitarReductionRuntime
>;

const snapshotPath = path.join(
  process.cwd(),
  'public/data/guitar-difficulties/guitar-reduction-e101baa.json',
);

function expertGuitarTrack() {
  const snapshot = JSON.parse(
    fs.readFileSync(snapshotPath, 'utf8'),
  ) as GuitarReductionSnapshot;
  const doc = readChart([
    {
      fileName: 'notes.chart',
      data: new TextEncoder().encode(snapshotToChartText(snapshot)),
    },
  ]);
  const expert = doc.parsedChart.trackData.find(
    track => track.instrument === 'guitar' && track.difficulty === 'expert',
  );
  if (!expert) throw new Error('fixture is missing an Expert guitar track');
  return {chart: doc.parsedChart, expert};
}

/** Resolves every tier so the reducer emits all three per-tier progress
 *  messages, then fails in decoding on the missing model outputs. */
function stubRuntime() {
  mockedLoadRuntime.mockImplementation(
    async () =>
      ({
        manifest: {tiers: {hard: {}, medium: {}, easy: {}}},
        mediumPhraseDictionary: null,
        runTier: async () => ({outputs: {}}),
      }) as unknown as GuitarReductionRuntime,
  );
}

async function collectProgress(
  instrumentLabel?: string,
): Promise<readonly string[]> {
  const {chart, expert} = expertGuitarTrack();
  const messages: string[] = [];
  await reduceGuitarDifficulties(
    chart,
    expert,
    p => messages.push(p.message),
    instrumentLabel ? {instrumentLabel} : undefined,
  ).catch(() => undefined);
  return messages;
}

describe('reduceGuitarDifficulties progress copy', () => {
  beforeEach(() => {
    mockedLoadRuntime.mockReset();
    stubRuntime();
  });

  it('names bass in every per-tier message for a bass run', async () => {
    const messages = await collectProgress('bass');

    expect(messages).toEqual(
      expect.arrayContaining([
        'Reducing bass to hard…',
        'Reducing bass to medium…',
        'Reducing bass to easy…',
      ]),
    );
    expect(messages.some(message => message.includes('guitar'))).toBe(false);
  });

  it('defaults to guitar when no instrument label is given', async () => {
    const messages = await collectProgress();

    expect(messages).toContain('Reducing guitar to hard…');
  });

  it('names the instrument in the empty-track error', async () => {
    const {chart, expert} = expertGuitarTrack();
    const emptyTrack: Track = {...expert, noteEventGroups: []};

    await expect(
      reduceGuitarDifficulties(chart, emptyTrack, undefined, {
        instrumentLabel: 'bass',
      }),
    ).rejects.toThrow('The Expert bass track does not contain any notes.');
  });
});
