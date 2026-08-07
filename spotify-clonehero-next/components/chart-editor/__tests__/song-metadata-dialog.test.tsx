/**
 * @jest-environment jsdom
 */
/**
 * The song-details dialog (plan 0079 items 10-12).
 *
 * What this covers is the wiring the dialog owes `song.ini`: which difficulty
 * rows a chart earns, which of them carry a suggestion, that everything the
 * user types comes back out of `onSave`, and that choosing a drums intensity
 * re-anchors its staleness provenance. The recommendation maths, the state
 * machine and the copy have their own suites under `lib/chart-difficulty`.
 */

import '@testing-library/jest-dom';
import {act, render, screen, fireEvent} from '@testing-library/react';
import {createEmptyChart, noteFlags, noteTypes} from '@eliwhite/scan-chart';
import type {ParsedChart} from '@/lib/chart-edit';
import {recommendedDifficulty} from '@/lib/chart-difficulty';
import {emptyTrackData, mkNote} from '@/lib/chart-edit/__tests__/test-utils';

import SongMetadataDialog from '../SongMetadataDialog';
import type {SongIniMetadataValue} from '@/lib/chart-editor-core';

// Radix's Select scrolls its active item into view on open; jsdom implements
// neither this nor the pointer-capture APIs the listbox reads.
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
  Element.prototype.hasPointerCapture = jest.fn(() => false);
  Element.prototype.releasePointerCapture = jest.fn();
});

function chartWith(instruments: string[]): ParsedChart {
  const chart = createEmptyChart({
    format: 'chart',
    resolution: 192,
    bpm: 120,
    timeSignature: {numerator: 4, denominator: 4},
  });
  return {
    ...chart,
    trackData: instruments.map(instrument =>
      emptyTrackData(instrument as never, 'expert'),
    ),
  } as ParsedChart;
}

/** A 5-fret track dense enough to score: alternating green/red sixteenths. */
function fretTrack(instrument: 'guitar' | 'bass') {
  const groups = Array.from({length: 200}, (_, i) => {
    const tick = i * 48;
    return [
      {
        ...mkNote({
          tick,
          length: 0,
          type: i % 2 === 0 ? noteTypes.green : noteTypes.red,
          flags: noteFlags.strum,
        }),
        msTime: (tick / 192) * 500,
      },
    ];
  });
  return emptyTrackData(instrument, 'expert', {noteEventGroups: groups});
}

function fretChart(instrument: 'guitar' | 'bass'): ParsedChart {
  return {
    ...chartWith([instrument]),
    trackData: [fretTrack(instrument)],
  } as ParsedChart;
}

/** A drums chart dense enough to score, so the suggestion has something to
 *  offer. Sixteen eighth-note hat/kick pairs over four bars. */
function drumChart(): ParsedChart {
  const chart = chartWith(['drums']);
  const groups = [];
  for (let i = 0; i < 64; i++) {
    const tick = i * 96;
    const msTime = (tick / 192) * 500;
    groups.push([
      {...mkNote({tick, length: 0, type: noteTypes.kick, flags: 0}), msTime},
      {
        ...mkNote({
          tick,
          length: 0,
          type: noteTypes.yellowDrum,
          flags: noteFlags.cymbal,
        }),
        msTime,
      },
    ]);
  }
  return {
    ...chart,
    trackData: [emptyTrackData('drums', 'expert', {noteEventGroups: groups})],
  } as ParsedChart;
}

const BASE_VALUE: SongIniMetadataValue = {
  name: 'Song',
  artist: 'Artist',
  charter: 'Charter',
  album: '',
  genre: '',
  year: '',
  difficulties: {},
};

function renderDialog(
  chart: ParsedChart,
  overrides: Partial<SongIniMetadataValue> = {},
  currentDrumStamp?: string,
) {
  const onSave = jest.fn();
  const value = {...BASE_VALUE, ...overrides};
  const view = render(
    <SongMetadataDialog
      open
      onOpenChange={() => {}}
      value={value}
      onSave={onSave}
      chart={chart}
      currentDrumStamp={currentDrumStamp}
    />,
  );
  /** Close and reopen without unmounting, as the header button does. */
  const reopen = () => {
    for (const open of [false, true]) {
      view.rerender(
        <SongMetadataDialog
          open={open}
          onOpenChange={() => {}}
          value={value}
          onSave={onSave}
          chart={chart}
          currentDrumStamp={currentDrumStamp}
        />,
      );
    }
  };
  return {onSave, reopen};
}

describe('SongMetadataDialog', () => {
  it('offers a difficulty row per charted instrument and none for the rest', () => {
    renderDialog(chartWith(['guitar', 'drums', 'bass']));

    const row = (field: string) =>
      document.getElementById(`song-details-${field}`);
    expect(row('diff_guitar')).toBeInTheDocument();
    expect(row('diff_bass')).toBeInTheDocument();
    expect(row('diff_drums_real')).toBeInTheDocument();
    expect(row('diff_keys')).toBeNull();
  });

  it('shows no row for plain Drums, which rides on the Pro Drums choice', () => {
    renderDialog(chartWith(['guitar', 'drums', 'keys']));

    expect(document.getElementById('song-details-diff_drums')).toBeNull();
    expect(document.getElementById('song-details-diff_keys')).toBeNull();
  });

  it('shows an intensity of 0, which is a rating and not a blank', () => {
    renderDialog(chartWith(['bass']), {difficulties: {diff_bass: 0}});

    expect(document.getElementById('song-details-diff_bass')).toHaveTextContent(
      '0',
    );
  });

  it('saves the catalog fields and trims them', async () => {
    const {onSave} = renderDialog(chartWith(['guitar']));

    fireEvent.change(screen.getByLabelText('Album'), {
      target: {value: '  Some Album  '},
    });
    fireEvent.change(screen.getByLabelText('Genre'), {
      target: {value: 'Rock'},
    });
    fireEvent.change(screen.getByLabelText('Year'), {target: {value: '2004'}});
    await act(async () => {
      fireEvent.click(screen.getByRole('button', {name: 'Save'}));
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        album: 'Some Album',
        genre: 'Rock',
        year: '2004',
      }),
    );
  });

  it('sets both drum fields from the suggestion, per the Pro Drums convention', async () => {
    const {onSave} = renderDialog(drumChart(), {}, 'stamp-now');

    const chip = screen.getByRole('button', {name: /Suggested: \d/});
    const suggested = Number(chip.textContent!.match(/\d/)![0]);
    fireEvent.click(chip);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', {name: 'Save'}));
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        difficulties: expect.objectContaining({
          diff_drums: suggested,
          diff_drums_real: suggested,
        }),
        // Choosing an intensity anchors it to the chart as it stands now, so
        // it does not immediately read as stale.
        drumDifficultyStamp: 'stamp-now',
      }),
    );
  });

  it('sets both drum fields from the Pro Drums select, which plain Drums has no row to override', async () => {
    const {onSave} = renderDialog(drumChart(), {}, 'stamp-now');

    fireEvent.keyDown(screen.getByLabelText('Pro Drums'), {key: 'Enter'});
    // Awaited outside the `act` below: `findBy*` polls with act disabled, so
    // the listbox's own mount-time updates would warn if it ran inside one.
    const option = await screen.findByRole('option', {name: '4'});
    await act(async () => {
      fireEvent.click(option);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', {name: 'Save'}));
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        difficulties: expect.objectContaining({
          diff_drums: 4,
          diff_drums_real: 4,
        }),
        drumDifficultyStamp: 'stamp-now',
      }),
    );
  });

  it('accepting the guitar suggestion touches only the guitar field', async () => {
    const {onSave} = renderDialog(fretChart('guitar'));

    const chip = screen.getByRole('button', {name: /Suggested: \d/});
    const suggested = Number(chip.textContent!.match(/\d/)![0]);
    fireEvent.click(chip);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', {name: 'Save'}));
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        difficulties: {diff_guitar: suggested},
      }),
    );
  });

  it('discards an abandoned edit when the dialog is reopened', async () => {
    const {onSave, reopen} = renderDialog(chartWith(['guitar']));

    fireEvent.change(screen.getByLabelText('Album'), {
      target: {value: 'Abandoned'},
    });
    reopen();
    expect(screen.getByLabelText('Album')).toHaveValue('');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', {name: 'Save'}));
    });
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({album: '', name: 'Song'}),
    );
  });

  it('suggests on the Pro Drums row and leaves plain Drums alone', () => {
    renderDialog(drumChart());

    // One suggestion for the drum kit, not one per drum field.
    expect(screen.getAllByRole('button', {name: /Suggested: \d/})).toHaveLength(
      1,
    );
    expect(
      screen.getByText(/^Based on .+ we suggest intensity \d\.$/),
    ).toBeInTheDocument();
  });

  it('names the factors behind the guitar suggestion', () => {
    renderDialog(fretChart('guitar'));
    expect(
      screen.getByText(/^Based on .+ other factors we suggest intensity \d\.$/),
    ).toBeInTheDocument();
  });

  it('shows the pills and the factor sentences, and nothing else', () => {
    renderDialog(fretChart('bass'));

    expect(
      screen.getByText(/^Based on .+ we suggest intensity \d\.$/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/fitted on a fifth as many charts/)).toBeNull();
    expect(screen.queryByText(/Difficulty is a 0-6 intensity/)).toBeNull();
    expect(screen.queryByText(/also name the project/)).toBeNull();
  });

  it('offers nothing to accept when the chart agrees with us', () => {
    const chart = fretChart('guitar');
    const suggested = recommendedDifficulty(chart, 'guitar')!;
    renderDialog(chart, {difficulties: {diff_guitar: suggested}});

    expect(screen.queryByText('Matches our read')).toBeNull();
    expect(
      screen.queryByRole('button', {name: /Suggested: \d/}),
    ).not.toBeInTheDocument();
    // The factor sentence still names the number the field already holds.
    expect(
      screen.getByText(new RegExp(`we suggest intensity ${suggested}\\.$`)),
    ).toBeInTheDocument();
  });

  it('has nothing to say about a chart it cannot score', () => {
    renderDialog(chartWith(['guitar']));
    expect(screen.queryByText(/we suggest intensity/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No recommendation/)).toBeNull();
  });

  it('flags a stored intensity as stale when the chart moved under it', () => {
    renderDialog(
      drumChart(),
      {difficulties: {diff_drums_real: 0}, drumDifficultyStamp: 'stamp-old'},
      'stamp-new',
    );
    expect(
      screen.getByRole('button', {name: /Chart changed, now reads \d/}),
    ).toBeInTheDocument();
  });
});
