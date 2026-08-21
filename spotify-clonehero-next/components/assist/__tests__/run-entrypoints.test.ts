/**
 * Every surface that starts an assist run declares which entrypoint it is
 * (plan 0105 Stage 3).
 *
 * This walks the call sites instead of asserting on four of them, because
 * the failure it guards against is a NEW call site, not a changed one. A
 * surface added later that quietly reports the wrong entrypoint is worse
 * than one that reports nothing: it lands in another tool's column and
 * nothing about the numbers looks wrong.
 *
 * Detection is by the `entrypoint:` literal, not by the shape of the call.
 * An earlier version matched `runner.start(` and missed the two call sites
 * that destructure it under another name (`start: startAssistTask`) — a
 * green test guaranteeing nothing. The literal is the thing being asserted
 * about, so looking for it directly cannot miss a renamed caller.
 *
 * The compiler already forces every caller to pass an `AssistRunContext`.
 * What it cannot check is that the value is the truth; that is what the
 * table below pins.
 *
 * Known limit: a future caller that forwards an entrypoint it received as a
 * variable would carry no literal and would not be seen here. If that ever
 * becomes a real pattern, this has to move to an AST walk.
 */

import {readFileSync, readdirSync} from 'fs';
import {join} from 'path';

const ROOT = join(__dirname, '..', '..', '..');
/** `lib` is included so a call site that moves out of the UI is still seen. */
const SEARCH_DIRS = ['app', 'components', 'lib'];

/** Which entrypoint each call site is required to report. */
const EXPECTED: Record<string, string> = {
  // The sidebar's shared run helper, covering all four Chart Assist cards.
  'components/chart-editor/hooks/useAssistTaskRun.ts': 'assist-card',
  'components/chart-editor/AddLyricsDialog.tsx': 'dialog',
  'components/chart-editor/hooks/useDifficultyGeneration.ts': 'matrix-row',
  'components/difficulty-generation/DifficultyGenerationFlow.tsx': 'landing',
  'app/add-lyrics/AddLyricsClient.tsx': 'landing',
  'app/tempo/TempoClient.tsx': 'landing',
  'app/drum-transcription/DrumTranscriptionClient.tsx': 'landing',
};

const ENTRYPOINTS = ['landing', 'assist-card', 'matrix-row', 'dialog'];
const DECLARES_ENTRYPOINT = /entrypoint:\s*'([a-z-]+)'/g;

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), {withFileTypes: true})) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      found.push(...sourceFiles(rel));
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(rel);
    }
  }
  return found;
}

/** Every file declaring an entrypoint, mapped to the ones it declares. */
const declared = new Map<string, string[]>();
for (const file of SEARCH_DIRS.flatMap(sourceFiles)) {
  const source = readFileSync(join(ROOT, file), 'utf8');
  const found = [...source.matchAll(DECLARES_ENTRYPOINT)].map(m => m[1]);
  if (found.length > 0) declared.set(file, found);
}

test('the set of call sites is the set this table accounts for', () => {
  // A new call site fails here. Add it to EXPECTED with the entrypoint it
  // truly is — do not reach for whichever value makes the test pass.
  expect([...declared.keys()].sort()).toEqual(Object.keys(EXPECTED).sort());
});

test('each call site declares exactly one entrypoint, and the right one', () => {
  for (const [file, entrypoint] of Object.entries(EXPECTED)) {
    // One value per file, so a copied block cannot leave a stale entrypoint
    // behind beside the correct one.
    expect({file, declares: declared.get(file)}).toEqual({
      file,
      declares: [entrypoint],
    });
  }
});

test('every declared entrypoint is one the analytics type allows', () => {
  for (const values of declared.values()) {
    for (const value of values) expect(ENTRYPOINTS).toContain(value);
  }
});
