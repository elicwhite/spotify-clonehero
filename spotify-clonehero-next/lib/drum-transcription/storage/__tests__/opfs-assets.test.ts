/**
 * Passthrough asset storage.
 *
 * `writeProjectAssets` takes the project's WHOLE asset list, so an asset
 * dropped from that list has to disappear from OPFS as well as from the
 * manifest. That is what lets Song Details replace album art without
 * leaving the old cover behind — and, since scan-chart raises
 * `multipleAlbumArt` on a package carrying two, without shipping both.
 */

import {installFakeOPFS} from './fake-opfs';

import * as opfs from '../opfs';

const bytes = (n: number) => new Uint8Array([n]);

describe('writeProjectAssets', () => {
  let fake: ReturnType<typeof installFakeOPFS>;

  beforeEach(() => {
    fake = installFakeOPFS();
  });

  afterEach(() => {
    fake.reset();
  });

  it('round-trips the assets it was given', async () => {
    const {id} = await opfs.createProject('song');
    await opfs.writeProjectAssets(id, [
      {fileName: 'album.jpg', data: bytes(1)},
      {fileName: 'video.mp4', data: bytes(2)},
    ]);

    const read = await opfs.readProjectAssets(id);
    expect(read.map(a => a.fileName).sort()).toEqual([
      'album.jpg',
      'video.mp4',
    ]);
    expect(read.find(a => a.fileName === 'album.jpg')?.data).toEqual(bytes(1));
  });

  it('returns nothing for a project that never stored any', async () => {
    const {id} = await opfs.createProject('song');
    expect(await opfs.readProjectAssets(id)).toEqual([]);
  });

  it('deletes an asset left out of a later write, not just its manifest line', async () => {
    const {id} = await opfs.createProject('song');
    await opfs.writeProjectAssets(id, [
      {fileName: 'album.png', data: bytes(1)},
      {fileName: 'video.mp4', data: bytes(2)},
    ]);
    await opfs.writeProjectAssets(id, [
      {fileName: 'album.jpg', data: bytes(3)},
      {fileName: 'video.mp4', data: bytes(2)},
    ]);

    expect((await opfs.readProjectAssets(id)).map(a => a.fileName)).toEqual([
      'album.jpg',
      'video.mp4',
    ]);
    // The replaced cover's bytes are gone from storage, not merely unlisted.
    expect([...fake.store.keys()].some(k => k.endsWith('album.png'))).toBe(
      false,
    );
  });

  it('overwrites an asset kept under the same name', async () => {
    const {id} = await opfs.createProject('song');
    await opfs.writeProjectAssets(id, [
      {fileName: 'album.jpg', data: bytes(1)},
    ]);
    await opfs.writeProjectAssets(id, [
      {fileName: 'album.jpg', data: bytes(9)},
    ]);

    const read = await opfs.readProjectAssets(id);
    expect(read).toHaveLength(1);
    expect(read[0].data).toEqual(bytes(9));
  });

  it('clears every asset when given an empty list', async () => {
    const {id} = await opfs.createProject('song');
    await opfs.writeProjectAssets(id, [
      {fileName: 'album.jpg', data: bytes(1)},
    ]);
    await opfs.writeProjectAssets(id, []);

    expect(await opfs.readProjectAssets(id)).toEqual([]);
    expect([...fake.store.keys()].some(k => k.endsWith('album.jpg'))).toBe(
      false,
    );
  });

  it('writes nothing at all for an empty list on a project with no assets', async () => {
    const {id} = await opfs.createProject('song');
    const before = fake.store.size;
    await opfs.writeProjectAssets(id, []);
    expect(fake.store.size).toBe(before);
  });
});
