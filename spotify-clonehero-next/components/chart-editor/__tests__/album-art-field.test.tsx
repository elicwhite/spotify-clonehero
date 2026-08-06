/**
 * @jest-environment jsdom
 */
/**
 * The Song Details album art slot.
 *
 * Covers the wiring the dialog owes the host: art is a draft like every
 * other field (Cancel discards it, Save commits it), a host that gave no
 * slot gets no field, and a chart that never had its art touched has
 * nothing written on Save.
 *
 * Files arrive by drop rather than through the file input: React suppresses
 * a `change` event whose value did not move, and a file input's `value`
 * never does, so `fireEvent.change` on one is a no-op. Both affordances call
 * the same handler, and the input's own contract (that it accepts the types
 * `lib/album-art` can normalize) is asserted directly.
 *
 * jsdom has neither an image decoder nor a canvas raster backend, so those
 * two ends of `normalizeAlbumArt` are stubbed and everything between them —
 * the crop maths, the encode call, the file name — runs for real.
 */

import '@testing-library/jest-dom';
import {act, render, screen, fireEvent} from '@testing-library/react';
import {createEmptyChart} from '@eliwhite/scan-chart';
import type {ParsedChart} from '@/lib/chart-edit';
import type {SongIniMetadataValue} from '@/lib/chart-editor-core';
import {
  ALBUM_ART_ACCEPT,
  ALBUM_ART_FILE_NAME,
  type AlbumArtFile,
} from '@/lib/album-art';

import SongMetadataDialog, {type AlbumArtSlot} from '../SongMetadataDialog';

const NORMALIZED: AlbumArtFile = {
  fileName: ALBUM_ART_FILE_NAME,
  data: new Uint8Array([0xff, 0xd8, 0xff]),
};

/** The crop `normalizeAlbumArt` asked the canvas for, so the real
 *  normalization path can run under jsdom and still be observed. */
let lastDrawArgs: number[] = [];

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
  Element.prototype.hasPointerCapture = jest.fn(() => false);
  Element.prototype.releasePointerCapture = jest.fn();
  URL.createObjectURL = jest.fn(() => 'blob:art');
  URL.revokeObjectURL = jest.fn();

  // jsdom has neither an image decoder nor a canvas raster backend, so the
  // two ends of `normalizeAlbumArt` are stubbed and everything between them
  // (the crop maths, the encode call, the file name) runs for real.
  (globalThis as {createImageBitmap?: unknown}).createImageBitmap = jest.fn(
    async () => ({width: 3000, height: 1000, close: () => {}}),
  );
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    drawImage: (_img: unknown, ...args: number[]) => {
      lastDrawArgs = args;
    },
  })) as unknown as HTMLCanvasElement['getContext'];
  // A stand-in for the encoded blob. jsdom's own Blob has no
  // `arrayBuffer()`, and reading one through FileReader would resolve on a
  // macrotask that `act` doesn't flush — so the stub answers on a microtask.
  HTMLCanvasElement.prototype.toBlob = function (callback) {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
    callback({
      arrayBuffer: async () => bytes.buffer,
    } as unknown as Blob);
  };
});

const VALUE: SongIniMetadataValue = {
  name: 'Song',
  artist: 'Artist',
  charter: 'Charter',
  album: '',
  genre: '',
  year: '',
  difficulties: {},
};

function emptyChart(): ParsedChart {
  return {
    ...createEmptyChart({
      format: 'chart',
      resolution: 192,
      bpm: 120,
      timeSignature: {numerator: 4, denominator: 4},
    }),
    trackData: [],
  } as ParsedChart;
}

function renderDialog(albumArt?: AlbumArtSlot) {
  const onSave = jest.fn();
  const view = render(
    <SongMetadataDialog
      open
      onOpenChange={() => {}}
      value={VALUE}
      onSave={onSave}
      chart={emptyChart()}
      albumArt={albumArt}
    />,
  );
  const reopen = () => {
    for (const open of [false, true]) {
      view.rerender(
        <SongMetadataDialog
          open={open}
          onOpenChange={() => {}}
          value={VALUE}
          onSave={onSave}
          chart={emptyChart()}
          albumArt={albumArt}
        />,
      );
    }
  };
  return {onSave, reopen};
}

/** An art slot whose `onChange` records what the dialog committed. */
function slot(current: AlbumArtFile | null = null): AlbumArtSlot & {
  onChange: jest.Mock;
} {
  return {current, onChange: jest.fn()};
}

/** Drop an image on the art square. */
async function dropFile(type = 'image/png') {
  const zone = screen.getByRole('button', {name: /album art$/});
  const file = new File(['x'], 'cover.png', {type});
  await act(async () => {
    fireEvent.drop(zone, {dataTransfer: {files: [file]}});
  });
}

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', {name: 'Save'}));
  });
}

describe('Song Details album art', () => {
  it('shows no field at all when the host has nowhere to store art', () => {
    renderDialog(undefined);
    expect(screen.queryByText('Album Art')).not.toBeInTheDocument();
  });

  it('invites art on a chart that has none, and offers no way to remove it', () => {
    renderDialog(slot(null));
    expect(
      screen.getByRole('button', {name: 'Add album art'}),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {name: 'Remove'}),
    ).not.toBeInTheDocument();
  });

  it('previews existing art and offers to replace or remove it', () => {
    renderDialog(slot(NORMALIZED));
    expect(
      screen.getByRole('button', {name: 'Replace album art'}),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', {name: 'Album art'})).toHaveAttribute(
      'src',
      'blob:art',
    );
    expect(screen.getByRole('button', {name: /Remove/})).toBeInTheDocument();
  });

  it('writes nothing when the dialog never touched the art', async () => {
    const art = slot(NORMALIZED);
    renderDialog(art);
    await save();
    expect(art.onChange).not.toHaveBeenCalled();
  });

  it('accepts exactly the image types the normalizer can take', () => {
    renderDialog(slot(null));
    expect(document.querySelector('input[type="file"]')).toHaveAttribute(
      'accept',
      ALBUM_ART_ACCEPT,
    );
  });

  it('crops a non-square image to its center square and draws it at 512', async () => {
    renderDialog(slot(null));
    await dropFile();
    // The stub bitmap is 3000×1000, so the centered square starts at x=1000.
    expect(lastDrawArgs).toEqual([1000, 0, 1000, 1000, 0, 0, 512, 512]);
  });

  it('says so when the dropped file is not an image it can use', async () => {
    const art = slot(null);
    renderDialog(art);
    await dropFile('audio/ogg');
    expect(screen.getByText(/must be a JPEG, PNG or WebP/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('commits a dropped image on Save, normalized', async () => {
    const art = slot(null);
    renderDialog(art);
    await dropFile();

    // Held as a draft until Save, like every other field on this dialog.
    expect(art.onChange).not.toHaveBeenCalled();

    await save();
    expect(art.onChange).toHaveBeenCalledWith(
      expect.objectContaining({fileName: ALBUM_ART_FILE_NAME}),
    );
  });

  it('commits a removal as null', async () => {
    const art = slot(NORMALIZED);
    renderDialog(art);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', {name: /Remove/}));
    });
    await save();
    expect(art.onChange).toHaveBeenCalledWith(null);
  });

  it('previews the dropped image before it is saved', async () => {
    renderDialog(slot(null));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    await dropFile();
    expect(screen.getByRole('img', {name: 'Album art'})).toBeInTheDocument();
  });

  it('discards an art edit that was abandoned, same as a text field', async () => {
    const art = slot(NORMALIZED);
    const {reopen} = renderDialog(art);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', {name: /Remove/}));
    });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    reopen();
    // Back to the chart's own art, and Save writes nothing.
    expect(screen.getByRole('img', {name: 'Album art'})).toBeInTheDocument();
    await save();
    expect(art.onChange).not.toHaveBeenCalled();
  });
});
