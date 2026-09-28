# config

Bundling a film with the product app's own sources. Node only.

A film draws the real highway with the app's renderer and imports app
modules, so its bundle must resolve the app's `@/...` imports, compile app
files with the app's TypeScript semantics (`useDefineForClassFields: false`),
keep one copy of the libraries the app and the film share, and find app
files' bare imports even where the app has no `node_modules` of its own.

A film states its options once, in `productApp.config.ts` beside its
remotion.config.ts. The config and the kit's tools both read it:

```ts
// films/<name>/productApp.config.ts
import type {ProductAppOptions} from '@musiccharts/video-kit/config';

const productApp: ProductAppOptions = {}; // the defaults
export default productApp;
```

```ts
// films/<name>/remotion.config.ts
import {Config} from '@remotion/cli/config';
import {withProductApp} from '@musiccharts/video-kit/config';
import productApp from './productApp.config';

withProductApp(Config, productApp);
```

```ts
// a tool that bundles
import {bundle} from '@remotion/bundler';
import {
  loadProductAppOptions,
  productAppPaths,
  productAppWebpack,
} from '@musiccharts/video-kit/config';

const options = await loadProductAppOptions(filmRoot);
const paths = productAppPaths(filmRoot, options);
const serveUrl = await bundle({
  entryPoint: path.join(filmRoot, 'src/index.ts'),
  webpackOverride: productAppWebpack(filmRoot, options),
  publicDir: paths.publicDir,
});
```

| Export                                  | What it is                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ProductAppOptions`                     | `{appRoot?}`: what a film states                                                                          |
| `withProductApp(Config, options?)`      | Sets the webpack override and ANGLE for the film Remotion runs the config in. Returns the resolved paths. |
| `loadProductAppOptions(filmRoot)`       | A film's `productApp.config.ts` default export, or `{}` without one                                       |
| `productAppPaths(filmRoot, options?)`   | `{appRoot, kitRoot, filmRoot, publicDir}`, all absolute; `publicDir` is always the film's own `public/`   |
| `productAppWebpack(filmRoot, options?)` | The webpack override alone, for `bundle()` or to compose with a film's own override                       |
| `productAppChromiumOptions`             | `{gl: 'angle'}` for `renderMedia`/`renderStill`                                                           |
| `PRODUCT_APP_CONFIG`                    | `'productApp.config.ts'`                                                                                  |

`appRoot` is relative to the film; by default it is the app next to the
videos workspace, found from the kit's own location (`videos/kit` →
`../../spotify-clonehero-next`).

What the override does:

- aliases `@` and `@product` to the app root;
- aliases `react-dom`, `three` and `@eliwhite/scan-chart` to one real copy
  (the film's, else the kit's); React and Remotion are already pinned by
  Remotion's own config;
- adds the film's and the kit's `node_modules` as fallbacks for bare
  imports from app files;
- compiles `.ts`/`.tsx` under the app root with `useDefineForClassFields:
false`.

## Rules

- `productApp.config.ts` is the one place a film says where its app is;
  nothing else takes it as a flag.
- A film always serves its own `public/`: the kit's paths
  (`generated/...`, `product/...`) live there. Its `public/generated/`
  holds the song material, and the app's art comes in through a committed
  symlink, `public/product -> <app>/public/assets` (`new-film` makes it).
  Remotion's bundler forwards symlinks instead of copying them.
- `withProductApp` owns the webpack override. A film with an override of its
  own calls `productAppWebpack()` inside it instead.
- Node loads this folder straight from remotion.config.ts (type stripping,
  not a bundler), so its own relative imports carry a `.ts` extension and
  its type imports use `import type`.
