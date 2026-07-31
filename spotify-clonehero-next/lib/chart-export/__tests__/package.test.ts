/**
 * Container packaging shared by every export flow ({@link packageChartFiles}).
 */

import {unzipSync, strFromU8} from 'fflate';
import type {File as FileEntry} from '@eliwhite/scan-chart';
import {packageChartFiles} from '../package';

const FILES: FileEntry[] = [
  {fileName: 'notes.chart', data: new TextEncoder().encode('[Song]\n{\n}\n')},
  {
    fileName: 'song.ini',
    data: new TextEncoder().encode('[song]\nname = Test\n'),
  },
  {fileName: 'song.opus', data: new Uint8Array([1, 2, 3, 4])},
];

describe('packageChartFiles', () => {
  it('zips every entry verbatim under its own name', async () => {
    const {blob, extension} = packageChartFiles(FILES, 'zip');

    expect(extension).toBe('zip');
    expect(blob.type).toBe('application/zip');

    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual([
      'notes.chart',
      'song.ini',
      'song.opus',
    ]);
    expect(strFromU8(zip['notes.chart'])).toBe('[Song]\n{\n}\n');
    expect(Array.from(zip['song.opus'])).toEqual([1, 2, 3, 4]);
  });

  it('packages sng as an octet-stream', async () => {
    const {blob, extension} = packageChartFiles(FILES, 'sng');

    expect(extension).toBe('sng');
    expect(blob.type).toBe('application/octet-stream');

    // The SNG header identifies the container; song.ini is folded into its
    // metadata rather than shipping as a file entry.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(strFromU8(bytes.slice(0, 6))).toBe('SNGPKG');
  });

  it('produces different containers from the same entries', async () => {
    const zip = await packageChartFiles(FILES, 'zip').blob.arrayBuffer();
    const sng = await packageChartFiles(FILES, 'sng').blob.arrayBuffer();
    expect(new Uint8Array(zip)).not.toEqual(new Uint8Array(sng));
  });
});
