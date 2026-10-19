/**
 * Resolution for tests that load kit code built on the product. Importing
 * this module registers it: `@product/lib/...` and `@product/components/...`
 * map to core's source (packages/core/src), as withProductApp maps them for
 * webpack, and the app's own `@/...` alias to the app's source root. Package
 * imports inside the app's and core's files resolve to the kit's packages
 * (three, scan-chart), so they need no node_modules of their own. The hook is
 * synchronous (`registerHooks`), so it also covers those files, which tsx
 * (`--import tsx`) compiles and loads as CommonJS: their packages load as the
 * kit's CommonJS builds.
 *
 * Import it before the code, and that code dynamically (static imports are
 * resolved before any module runs):
 *
 *   import './fixtures/product-resolve.mjs';
 *   const geometry = await import('../src/highway/highwayGeometry.ts');
 */
import fs from 'node:fs';
import {createRequire, registerHooks} from 'node:module';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const KIT = fileURLToPath(new URL('../../', import.meta.url));
const APP = path.resolve(KIT, '../../apps/site');
const CORE = path.resolve(KIT, '../../packages/core/src');
const APP_URL = pathToFileURL(`${APP}${path.sep}`).href;
const CORE_URL = pathToFileURL(`${CORE}${path.sep}`).href;
const KIT_PACKAGE_URL = pathToFileURL(path.join(KIT, 'package.json')).href;
const kitRequire = createRequire(KIT_PACKAGE_URL);

/** Each alias prefix and the source folder it maps to. */
const ALIASES = [
  ['@product/lib/', CORE],
  ['@product/components/', path.join(CORE, 'components')],
  ['@/', APP],
];

/** The source file an aliased specifier names, or null. */
const appSource = specifier => {
  const alias = ALIASES.find(([prefix]) => specifier.startsWith(prefix));
  if (!alias) return null;
  const [prefix, root] = alias;
  const base = path.join(root, specifier.slice(prefix.length));
  const file = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find(
    candidate => fs.existsSync(candidate),
  );
  if (!file)
    throw new Error(`[product-resolve] no source file for ${specifier}`);
  return pathToFileURL(file).href;
};

const isPackage = specifier => !/^(\.|\/|file:|node:|data:)/.test(specifier);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = appSource(specifier);
    if (source) return nextResolve(source, context);
    const parent = context.parentURL ?? '';
    if (
      !isPackage(specifier) ||
      !(parent.startsWith(APP_URL) || parent.startsWith(CORE_URL))
    )
      return nextResolve(specifier, context);
    // CommonJS resolution looks from the requiring file whatever the context
    // says, so a require is resolved here; an import follows `parentURL`.
    if (context.conditions?.includes('require'))
      return {
        url: pathToFileURL(kitRequire.resolve(specifier)).href,
        shortCircuit: true,
      };
    return nextResolve(specifier, {...context, parentURL: KIT_PACKAGE_URL});
  },
});
