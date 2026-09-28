#!/usr/bin/env node
// Points a workspace package's Remotion browser cache at the workspace's
// shared one, so every film, the gallery and the kit's scripts use the one
// headless Chrome instead of each downloading its own.
//
//   node <kit>/scripts/link-browser.mjs      (run in the package's folder)
//
// Remotion looks for its browser in <nearest package>/node_modules/.remotion.
// This links that folder to videos/node_modules/.remotion, creating the
// shared folder if needed. Every package runs it as its postinstall. It
// leaves a real folder in place (a package that already has a browser of its
// own) and exits 0 either way, so an install never fails on it.

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const kitRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const shared = path.resolve(kitRoot, '..', 'node_modules', '.remotion');
const link = path.resolve(process.cwd(), 'node_modules', '.remotion');

const describe = p => path.relative(process.cwd(), p) || '.';

try {
  fs.mkdirSync(shared, {recursive: true});
  const stat = fs.lstatSync(link, {throwIfNoEntry: false});
  if (
    stat?.isSymbolicLink() &&
    fs.realpathSync(link) === fs.realpathSync(shared)
  ) {
    process.exit(0);
  }
  if (stat && !stat.isSymbolicLink()) {
    console.log(
      `link-browser: ${describe(link)} is a folder of its own; left as it is`,
    );
    process.exit(0);
  }
  if (stat) fs.unlinkSync(link);
  fs.mkdirSync(path.dirname(link), {recursive: true});
  fs.symlinkSync(path.relative(path.dirname(link), shared), link, 'dir');
  console.log(`link-browser: ${describe(link)} -> ${describe(shared)}`);
  if (!fs.existsSync(path.join(shared, 'chrome-headless-shell'))) {
    console.log(
      'link-browser: no headless Chrome yet; see "The headless browser" in videos/README.md',
    );
  }
} catch (error) {
  console.log(
    `link-browser: skipped (${error instanceof Error ? error.message : error})`,
  );
}
