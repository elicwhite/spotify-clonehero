/**
 * Resolution for tests that load kit code built on core. Importing this
 * module registers it: `@musiccharts/core/...` maps to core's source
 * (packages/core/src), as withProductApp maps it for webpack. Core's package
 * exports point at extensionless paths, which Node does not complete. The
 * hook is synchronous (`registerHooks`), so it also covers the core files,
 * which tsx (`--import tsx`) compiles and loads as CommonJS.
 *
 * Import it before the code, and that code dynamically (static imports are
 * resolved before any module runs):
 *
 *   import './fixtures/product-resolve.mjs';
 *   const geometry = await import('../src/highway/highwayGeometry.ts');
 */
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const KIT = fileURLToPath(new URL('../../', import.meta.url));
const CORE = path.resolve(KIT, '../../packages/core/src');
const PREFIX = '@musiccharts/core/';

/** The core source file a `@musiccharts/core/...` specifier names, or null. */
const coreSource = specifier => {
  if (!specifier.startsWith(PREFIX)) return null;
  const base = path.join(CORE, specifier.slice(PREFIX.length));
  const file = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find(
    candidate => fs.existsSync(candidate),
  );
  if (!file)
    throw new Error(`[product-resolve] no source file for ${specifier}`);
  return pathToFileURL(file).href;
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = coreSource(specifier);
    return nextResolve(source ?? specifier, context);
  },
});
