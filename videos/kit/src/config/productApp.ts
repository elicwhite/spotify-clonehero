/**
 * Bundling a film with the product app's own sources (Node only).
 *
 * A film draws the real highway with the app's three.js renderer and reads
 * app modules, so its bundle must:
 * - resolve `@/...` (the app's own imports) and `@product/...` (the film's
 *   imports of app code) to the app's source root;
 * - compile app sources with the app's TypeScript semantics: the app leaves
 *   `useDefineForClassFields` off, while the kit's ES2022 target turns it
 *   on, and the difference changes what declared-only class fields do;
 * - keep one copy of each library the app, the kit and the film share
 *   (the highway's asset hooks need a single THREE);
 * - find bare imports from app files even where the app has no
 *   node_modules of its own (a worktree), through the film's and the kit's.
 *
 * A film states where its app is in ONE module, `productApp.config.ts`
 * beside its remotion.config.ts. The config passes it to
 * `withProductApp(Config, options)`; tools that bundle read it with
 * `loadProductAppOptions(filmRoot)` and pass it to `productAppWebpack` and
 * `productAppPaths`. A film always serves its own `public/`: the kit's paths
 * (`generated/...`, the `product` link to the app's art) live there.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import type {WebpackOverrideFn} from '@remotion/bundler';
import type {Config} from '@remotion/cli/config';

/** The kit package's folder, from this file's own location. */
const KIT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

/** Where the app sits relative to the kit: videos/kit -> ../../spotify-clonehero-next. */
const DEFAULT_APP_ROOT = path.resolve(KIT_ROOT, '../../spotify-clonehero-next');

/** The module a film states its options in, beside its remotion.config.ts. */
export const PRODUCT_APP_CONFIG = 'productApp.config.ts';

/**
 * Libraries aliased to a single copy. React and Remotion are already pinned
 * to one copy by Remotion's own webpack config.
 */
const SINGLE_COPY = ['react-dom', 'three', '@eliwhite/scan-chart'] as const;

/** What a film states in its productApp.config.ts. */
export interface ProductAppOptions {
  /** The app's source root, relative to the film. Default: the app next to the videos workspace. */
  appRoot?: string;
}

export interface ProductAppPaths {
  appRoot: string;
  kitRoot: string;
  filmRoot: string;
  /** The film's own public/, the folder Remotion serves. */
  publicDir: string;
}

/** A film's options: its productApp.config.ts's default export, or none. */
export const loadProductAppOptions = async (
  filmRoot: string,
): Promise<ProductAppOptions> => {
  const file = path.resolve(filmRoot, PRODUCT_APP_CONFIG);
  if (!fs.existsSync(file)) return {};
  const module = (await import(pathToFileURL(file).href)) as {
    default?: ProductAppOptions;
  };
  return module.default ?? {};
};

/** Where everything is, for a film at `filmRoot` with its options. */
export const productAppPaths = (
  filmRoot: string,
  options: ProductAppOptions = {},
): ProductAppPaths => {
  const film = path.resolve(filmRoot);
  const appRoot = options.appRoot
    ? path.resolve(film, options.appRoot)
    : DEFAULT_APP_ROOT;
  if (!fs.existsSync(path.join(appRoot, 'package.json'))) {
    throw new Error(
      `[productApp] no app at ${appRoot}; set appRoot in ${PRODUCT_APP_CONFIG}`,
    );
  }
  return {
    appRoot,
    kitRoot: KIT_ROOT,
    filmRoot: film,
    publicDir: path.join(film, 'public'),
  };
};

/** A package's real folder in the first node_modules that has it, else null. */
const packageDir = (name: string, roots: readonly string[]): string | null => {
  for (const root of roots) {
    const dir = path.join(root, 'node_modules', name);
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return fs.realpathSync(dir);
    }
  }
  return null;
};

type WebpackConfig = Parameters<WebpackOverrideFn>[0];
type Rule = NonNullable<NonNullable<WebpackConfig['module']>['rules']>[number];
type ObjectRule = Extract<Rule, {test?: unknown}>;

const isTsRule = (rule: Rule): rule is ObjectRule =>
  typeof rule === 'object' &&
  rule !== null &&
  'test' in rule &&
  rule.test instanceof RegExp &&
  rule.test.test('file.tsx');

/** The webpack override for a film (or a tool's `bundle()`) that uses app code. */
export const productAppWebpack = (
  filmRoot: string,
  options: ProductAppOptions = {},
): WebpackOverrideFn => {
  // Resolve now: Remotion runs the override later, from another directory.
  const {appRoot, kitRoot, filmRoot: film} = productAppPaths(filmRoot, options);
  const roots = [film, kitRoot];
  const singles: Record<string, string> = {};
  for (const name of SINGLE_COPY) {
    const dir = packageDir(name, roots);
    if (dir) singles[name] = dir;
  }

  return config => {
    const rules = config.module?.rules ?? [];
    const tsRule = rules.find(isTsRule);
    if (!tsRule || !Array.isArray(tsRule.use)) {
      throw new Error(
        '[productApp] Remotion no longer has the TypeScript rule this override extends',
      );
    }
    const appUse = tsRule.use.map(entry =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof entry.options === 'object'
        ? {
            ...entry,
            options: {
              ...entry.options,
              tsconfigRaw: {
                compilerOptions: {
                  useDefineForClassFields: false,
                  jsx: 'react-jsx',
                },
              },
            },
          }
        : entry,
    );

    return {
      ...config,
      module: {
        ...config.module,
        rules: [
          ...rules.map(rule =>
            rule === tsRule ? {...tsRule, exclude: appRoot} : rule,
          ),
          {test: /\.tsx?$/, include: appRoot, use: appUse},
        ],
      },
      resolve: {
        ...config.resolve,
        alias: {
          ...config.resolve?.alias,
          '@': appRoot,
          '@product': appRoot,
          ...singles,
        },
        modules: [
          ...(config.resolve?.modules ?? ['node_modules']),
          ...roots.map(root => path.join(root, 'node_modules')),
        ],
      },
    };
  };
};

/** Chromium options for `renderMedia`/`renderStill` of product-app films. */
export const productAppChromiumOptions = {gl: 'angle'} as const;

/**
 * Configure a film's remotion.config.ts for the product app, with the
 * options from its productApp.config.ts:
 *
 * ```ts
 * import {Config} from '@remotion/cli/config';
 * import {withProductApp} from '@musiccharts/video-kit/config';
 * import productApp from './productApp.config';
 * withProductApp(Config, productApp);
 * ```
 *
 * Remotion runs the config from the film's folder, which is the film root,
 * and serves that folder's `public/` by default. It sets the webpack
 * override, so a film with an override of its own composes
 * `productAppWebpack()` into it instead.
 */
export const withProductApp = (
  config: Pick<
    typeof Config,
    'overrideWebpackConfig' | 'setChromiumOpenGlRenderer'
  >,
  options: ProductAppOptions = {},
): ProductAppPaths => {
  const filmRoot = process.cwd();
  const paths = productAppPaths(filmRoot, options);
  config.setChromiumOpenGlRenderer(productAppChromiumOptions.gl);
  config.overrideWebpackConfig(productAppWebpack(filmRoot, options));
  return paths;
};
