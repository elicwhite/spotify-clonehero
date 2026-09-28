#!/usr/bin/env node
// The landing check: two takes of one spec must be byte-identical on every
// component the film uses before either one lands.
//
//   node --import tsx kit/scripts/recorder/compare-takes.mjs <take folder> <other take folder> \
//     [--components window,pianoRoll]   only these videos (default: every one)
//
// Record the spec twice (or once more, against the take it replaces) into
// different --out folders and compare. Chrome's anti-aliasing can change
// under GPU load (another render on the machine): now and then one frame of
// a take differs from its twin by a few pixels, and the encoder carries the
// difference to the end of its keyframe group. Such a take is fine to look
// at, but it is not reproducible; record again until two takes match.
// Compares the component videos and the manifests (without `recordedAt`).
// Exits 1 when they differ.

import fs from 'node:fs';
import path from 'node:path';
import {isMain, parseFlags, runCli, UsageError} from '../lib/cli.ts';

/**
 * Differences between two take folders: the listed component videos (all of
 * them by default) and the manifests without `recordedAt`. Empty when the
 * takes match.
 */
export function compareTakes(a, b, {components = null} = {}) {
  const problems = [];
  const read = dir => {
    const m = JSON.parse(
      fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'),
    );
    delete m.recordedAt;
    return m;
  };
  const ma = read(a);
  const mb = read(b);
  const names = components ?? Object.keys(ma.components);
  for (const name of names) {
    const one = ma.components[name];
    const two = mb.components[name];
    if (!one || !two) {
      problems.push(`${name}: not in both takes`);
      continue;
    }
    const va = fs.readFileSync(path.join(a, one.file));
    const vb = fs.readFileSync(path.join(b, two.file));
    if (!va.equals(vb)) problems.push(`${one.file} differs`);
  }
  if (JSON.stringify(ma) !== JSON.stringify(mb))
    problems.push('the manifests differ');
  return problems;
}

if (isMain(import.meta.url)) {
  runCli(
    'node --import tsx kit/scripts/recorder/compare-takes.mjs <take folder> <other take folder> [--components a,b]',
    () => {
      const {values, positionals} = parseFlags(
        {components: {type: 'string'}},
        process.argv.slice(2),
        true,
      );
      if (positionals.length !== 2)
        throw new UsageError('pass two take folders');
      const problems = compareTakes(positionals[0], positionals[1], {
        components: values.components ? values.components.split(',') : null,
      });
      if (problems.length) {
        console.error(`the takes differ: ${problems.join('; ')}`);
        process.exitCode = 1;
        return;
      }
      console.error('the takes are byte-identical');
    },
  );
}
