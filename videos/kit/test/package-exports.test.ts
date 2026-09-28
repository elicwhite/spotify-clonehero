import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = '@musiccharts/video-kit';

const pkg = JSON.parse(fs.readFileSync(path.join(KIT, 'package.json'), 'utf8'));
const exportsMap = pkg.exports as Record<string, string>;

const tsconfigFile = path.join(KIT, 'tsconfig.json');
const {config, error} = ts.readConfigFile(tsconfigFile, ts.sys.readFile);
if (error)
  throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
const paths = config.compilerOptions.paths as Record<string, string[]>;

describe("the kit's exports", () => {
  it('are exactly the subpaths the template typechecks against', () => {
    const fromExports = Object.entries(exportsMap)
      .filter(([sub]) => sub !== './package.json')
      .map(([sub, target]) => [NAME + sub.slice(1), [target]] as const);
    const fromPaths = Object.entries(paths).filter(([key]) =>
      key.startsWith(`${NAME}/`),
    );
    assert.deepEqual(
      Object.fromEntries(fromPaths),
      Object.fromEntries(fromExports),
    );
  });

  it('each name a file that exists', () => {
    for (const [sub, target] of Object.entries(exportsMap)) {
      const file = path.join(KIT, target.replace(/\/\*$/, ''));
      assert.ok(fs.existsSync(file), `${sub} -> ${target} is missing`);
    }
  });
});
