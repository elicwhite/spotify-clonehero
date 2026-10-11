import {describe, test, expect} from '@jest/globals';
import {unzipSync} from 'fflate';
import {PartedZip} from '../partedZip';

const bytes = (size: number, fill: number) => new Uint8Array(size).fill(fill);

async function entries(part: Blob) {
  const files = unzipSync(new Uint8Array(await part.arrayBuffer()));
  return Object.fromEntries(
    Object.entries(files).map(([path, data]) => [path, data.length]),
  );
}

describe('PartedZip', () => {
  test('keeps every file, at its path, in one part under the limit', async () => {
    const parts: Blob[] = [];
    const zip = new PartedZip(part => parts.push(part), 100);
    zip.add('Pack/A.sng', bytes(30, 1));
    zip.add('B.sng', bytes(40, 2));
    zip.finish();

    expect(parts).toHaveLength(1);
    expect(await entries(parts[0])).toEqual({'Pack/A.sng': 30, 'B.sng': 40});
  });

  test('starts a new part at the first file that would pass the limit', async () => {
    const parts: Blob[] = [];
    const zip = new PartedZip(part => parts.push(part), 100);
    zip.add('A.sng', bytes(60, 1));
    zip.add('B.sng', bytes(60, 2));
    // Larger than a whole part: it gets one to itself.
    zip.add('C.sng', bytes(150, 3));
    zip.finish();

    expect(parts).toHaveLength(3);
    expect(await entries(parts[0])).toEqual({'A.sng': 60});
    expect(await entries(parts[1])).toEqual({'B.sng': 60});
    expect(await entries(parts[2])).toEqual({'C.sng': 150});
  });

  test('stores files without compressing them', async () => {
    const parts: Blob[] = [];
    const zip = new PartedZip(part => parts.push(part), 10_000);
    zip.add('A.sng', bytes(4000, 7));
    zip.finish();

    // Deflate would shrink 4000 equal bytes to almost nothing.
    expect(parts[0].size).toBeGreaterThan(4000);
  });

  test('ends no part when nothing was added', () => {
    const parts: Blob[] = [];
    new PartedZip(part => parts.push(part), 100).finish();
    expect(parts).toEqual([]);
  });
});
