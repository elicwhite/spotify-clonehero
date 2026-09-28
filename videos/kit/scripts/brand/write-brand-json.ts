/**
 * Writes the brand colours as JSON for the Blender logo sting, atomically.
 * From videos/:
 *
 *   node --import tsx kit/scripts/brand/write-brand-json.ts --out <file>
 */
import path from 'node:path';
import {brandJson} from '../../src/brand/brandJson';
import {need, parseFlags, runCli} from '../lib/cli';
import {writeJsonAtomic} from '../lib/files';

const USAGE =
  'usage: node --import tsx kit/scripts/brand/write-brand-json.ts --out <file>';

runCli(USAGE, () => {
  const {values} = parseFlags({out: {type: 'string'}});
  const out = path.resolve(need(values.out, 'out'));
  writeJsonAtomic(out, brandJson(), 2);
  console.log(`wrote ${out}`);
});
