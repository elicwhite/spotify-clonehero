/**
 * Starts a new film: copies kit/template into videos/films/<name>, fills in
 * its name and title, records a non-default app in its productApp.config.ts,
 * and links the app's art into its public folder.
 *
 * From videos/:
 *   pnpm new-film --name <slug> [--title "<Product name>"] [--app <app root>]
 *   node --import tsx kit/scripts/new-film.ts --name <slug> ...   (the same)
 *
 * The new film renders as it is: its timeline is a tempo bed, so it needs no
 * song material. Then run `pnpm install` in videos/ to link it into the
 * workspace. Refuses to write over an existing folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  PRODUCT_APP_CONFIG,
  productAppPaths,
  type ProductAppOptions,
} from '../src/config/index.ts';
import {need, parseFlags, runCli, UsageError} from './lib/cli';

const KIT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const TEMPLATE = path.join(KIT_ROOT, 'template');
const FILMS = path.resolve(KIT_ROOT, '..', 'films');

const USAGE =
  'usage: node --import tsx kit/scripts/new-film.ts --name <slug> [--title "<Product name>"] [--app <app root>]';

/** "chart-editor" -> "Chart Editor". */
const titleOf = (slug: string): string =>
  slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/** A value inside a single-quoted TypeScript string. */
const tsString = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Copies the template into `to`, filling in the film's name and title. */
const copyTemplate = (
  from: string,
  to: string,
  fill: (text: string, file: string) => string,
): void => {
  fs.mkdirSync(to, {recursive: true});
  for (const entry of fs.readdirSync(from, {withFileTypes: true})) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTemplate(source, target, fill);
    else
      fs.writeFileSync(target, fill(fs.readFileSync(source, 'utf8'), target));
  }
};

runCli(USAGE, () => {
  const {values} = parseFlags({
    name: {type: 'string'},
    title: {type: 'string'},
    app: {type: 'string'},
  });
  const slug = need(values.name, 'name');
  if (!/^[a-z0-9_][a-z0-9_-]*$/.test(slug)) {
    throw new UsageError(
      '--name is a folder slug: lowercase letters, digits, "-" and "_"',
    );
  }
  const title = values.title ?? titleOf(slug);
  const film = path.join(FILMS, slug);
  if (fs.existsSync(film)) throw new UsageError(`${film} already exists`);
  // The film records its app relative to itself, so the checkout can move.
  const options: ProductAppOptions = values.app
    ? {appRoot: path.relative(film, path.resolve(values.app))}
    : {};
  const {appRoot} = productAppPaths(film, options);

  copyTemplate(TEMPLATE, film, (text, file) =>
    text
      .replaceAll('{{FILM_SLUG}}', slug)
      .replaceAll(
        '{{FILM_TITLE}}',
        /\.tsx?$/.test(file) ? tsString(title) : title,
      ),
  );
  if (options.appRoot) {
    const config = path.join(film, PRODUCT_APP_CONFIG);
    const text = fs.readFileSync(config, 'utf8');
    const declared = 'const productApp: ProductAppOptions = {};';
    if (!text.includes(declared)) {
      throw new Error(`${PRODUCT_APP_CONFIG} in the template has changed`);
    }
    fs.writeFileSync(
      config,
      text.replace(
        declared,
        `const productApp: ProductAppOptions = {appRoot: '${tsString(options.appRoot)}'};`,
      ),
    );
  }

  // The product's own art, served from the film's public folder: a relative
  // link, so the checkout can move.
  const publicDir = path.join(film, 'public');
  fs.mkdirSync(path.join(publicDir, 'generated'), {recursive: true});
  fs.symlinkSync(
    path.relative(publicDir, path.join(appRoot, 'public', 'assets')),
    path.join(publicDir, 'product'),
    'dir',
  );

  const inVideos = path.relative(path.dirname(FILMS), film);
  console.log(`Created videos/${inVideos} ("${title}").

Next, in videos/:
  pnpm install                      links the film into the workspace
  cd ${inVideos} && pnpm studio`);
});
