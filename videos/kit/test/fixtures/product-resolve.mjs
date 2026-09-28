/**
 * Resolution for tests that load kit code built on the app. Importing this
 * module registers it: the `@product/...` alias maps to the app's source
 * root, as withProductApp maps it for webpack, and the app's own `@/...`
 * alias to the same root. Package imports inside the app's files resolve to
 * the kit's packages (three, scan-chart), so the app needs no node_modules
 * of its own. The hook is synchronous (`registerHooks`), so it also covers
 * the app's files, which tsx (`--import tsx`) compiles and loads as
 * CommonJS: their packages load as the kit's CommonJS builds.
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
const APP = path.resolve(KIT, '../../spotify-clonehero-next');
const APP_URL = pathToFileURL(`${APP}${path.sep}`).href;
const KIT_PACKAGE_URL = pathToFileURL(path.join(KIT, 'package.json')).href;
const kitRequire = createRequire(KIT_PACKAGE_URL);

const ALIASES = ['@product/', '@/'];

/** The app source file an aliased specifier names, or null. */
const appSource = specifier => {
  const alias = ALIASES.find(prefix => specifier.startsWith(prefix));
  if (!alias) return null;
  const base = path.join(APP, specifier.slice(alias.length));
  const file = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find(
    candidate => fs.existsSync(candidate),
  );
  if (!file) throw new Error(`[product-resolve] no app file for ${specifier}`);
  return pathToFileURL(file).href;
};

const isPackage = specifier => !/^(\.|\/|file:|node:|data:)/.test(specifier);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = appSource(specifier);
    if (source) return nextResolve(source, context);
    if (!isPackage(specifier) || !context.parentURL?.startsWith(APP_URL))
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
