/**
 * Album art normalization rules — the parts that decide what a package ends
 * up containing, independent of the canvas work `normalizeAlbumArt` does.
 */

import {
  ALBUM_ART_ACCEPT,
  ALBUM_ART_FILE_NAME,
  ALBUM_ART_FILE_NAMES,
  MAX_ALBUM_ART_INPUT_BYTES,
  albumArtInputProblem,
  coverCropRect,
  isAlbumArtFileName,
  withAlbumArt,
} from '../index';

describe('isAlbumArtFileName', () => {
  it.each(ALBUM_ART_FILE_NAMES)('recognizes %s', name => {
    expect(isAlbumArtFileName(name)).toBe(true);
  });

  it('recognizes a differently-cased name, which a package can still carry', () => {
    expect(isAlbumArtFileName('Album.JPG')).toBe(true);
  });

  it('does not claim other images in the folder', () => {
    expect(isAlbumArtFileName('background.png')).toBe(false);
    expect(isAlbumArtFileName('albumart.jpg')).toBe(false);
    expect(isAlbumArtFileName('album.gif')).toBe(false);
  });
});

describe('coverCropRect', () => {
  it('is a no-op for an already-square image', () => {
    expect(coverCropRect(3000, 3000)).toEqual({sx: 0, sy: 0, size: 3000});
  });

  it('takes the centered square out of a landscape image', () => {
    expect(coverCropRect(1600, 900)).toEqual({sx: 350, sy: 0, size: 900});
  });

  it('takes the centered square out of a portrait image', () => {
    expect(coverCropRect(900, 1600)).toEqual({sx: 0, sy: 350, size: 900});
  });

  it('rounds the offset to a whole pixel on an odd difference', () => {
    const {sx, size} = coverCropRect(101, 100);
    expect(size).toBe(100);
    expect(Number.isInteger(sx)).toBe(true);
  });
});

describe('albumArtInputProblem', () => {
  it.each(ALBUM_ART_ACCEPT.split(','))('accepts %s', type => {
    expect(albumArtInputProblem({type, size: 1024})).toBeNull();
  });

  it('rejects a type the browser may not decode', () => {
    expect(albumArtInputProblem({type: 'image/tiff', size: 1024})).toMatch(
      /JPEG, PNG or WebP/,
    );
  });

  it('rejects a non-image outright', () => {
    expect(
      albumArtInputProblem({type: 'audio/ogg', size: 1024}),
    ).not.toBeNull();
  });

  it('rejects an image past the input cap, naming the limit', () => {
    expect(
      albumArtInputProblem({
        type: 'image/jpeg',
        size: MAX_ALBUM_ART_INPUT_BYTES + 1,
      }),
    ).toMatch(/32 MB/);
  });

  it('accepts an image exactly at the cap', () => {
    expect(
      albumArtInputProblem({
        type: 'image/jpeg',
        size: MAX_ALBUM_ART_INPUT_BYTES,
      }),
    ).toBeNull();
  });
});

describe('withAlbumArt', () => {
  const art = {fileName: ALBUM_ART_FILE_NAME, data: new Uint8Array([1])};

  it('appends art to a package that had none', () => {
    const out = withAlbumArt(
      [{fileName: 'video.mp4', data: new Uint8Array()}],
      art,
    );
    expect(out.map(a => a.fileName)).toEqual([
      'video.mp4',
      ALBUM_ART_FILE_NAME,
    ]);
  });

  it('replaces existing art rather than adding a second cover', () => {
    const out = withAlbumArt(
      [
        {fileName: 'album.png', data: new Uint8Array()},
        {fileName: 'video.mp4', data: new Uint8Array()},
      ],
      art,
    );
    expect(out.map(a => a.fileName)).toEqual([
      'video.mp4',
      ALBUM_ART_FILE_NAME,
    ]);
  });

  it('drops EVERY recognized name, so no package ends up with two covers', () => {
    const out = withAlbumArt(
      ALBUM_ART_FILE_NAMES.map(fileName => ({
        fileName,
        data: new Uint8Array(),
      })),
      art,
    );
    expect(out).toHaveLength(1);
    expect(out[0].fileName).toBe(ALBUM_ART_FILE_NAME);
  });

  it('removes art without adding any when passed null', () => {
    const out = withAlbumArt(
      [
        {fileName: 'album.jpg', data: new Uint8Array()},
        {fileName: 'video.mp4', data: new Uint8Array()},
      ],
      null,
    );
    expect(out.map(a => a.fileName)).toEqual(['video.mp4']);
  });

  it('leaves a list with no art alone', () => {
    const assets = [{fileName: 'video.mp4', data: new Uint8Array()}];
    expect(withAlbumArt(assets, null)).toEqual(assets);
  });
});
