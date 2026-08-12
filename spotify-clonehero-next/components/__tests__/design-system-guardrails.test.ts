/**
 * Guardrails for the specific regressions plan 0099 removed.
 *
 * Deliberately narrow. A broad rule ("no arbitrary Tailwind values") would
 * fight this codebase and get disabled within a release; these three each
 * name one thing that was actually wrong and got fixed, so a failure here is
 * always a real regression rather than a style opinion.
 *
 * The OG palette guardrails live next to the OG system in
 * `lib/og/__tests__/og-routes.test.ts`.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const SEARCH_DIRS = ['app', 'components', 'lib'].map(d => path.join(ROOT, d));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    // Tests describe the patterns they forbid, so scanning them would flag
    // the description rather than a regression.
    if (entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Comments explain why a pattern was removed and quote it while doing so,
 * which is documentation rather than a reintroduction.
 */
function code(file: string): string {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const files = SEARCH_DIRS.flatMap(sourceFiles);
const rel = (file: string) => path.relative(ROOT, file);

describe('no negative margin cancelling the SiteMain gutter', () => {
  /**
   * `components/SiteChrome.tsx` decides the outer gutter, and a route can now
   * ask for no gutter directly (`ROUTE_CHROME`). A page reaching back out with
   * `-m-4` and `w-[calc(100%+2rem)]` is re-creating the hack that would have
   * broken the day `SiteMain`'s padding changed.
   */
  it('no page widens itself past 100% to undo a parent gutter', () => {
    const offenders = files.filter(file =>
      /w-\[calc\(100%\s*\+/.test(code(file)),
    );

    expect(offenders.map(rel)).toEqual([]);
  });

  it('no page applies a negative margin on all sides', () => {
    // `-mx-1`/`-ml-1` style nudges are legitimate optical alignment; a
    // negative margin on every side is a container escaping its parent.
    // The leading `:` catches responsive forms like `sm:-m-4`.
    const offenders = files.filter(file =>
      /(?:^|["'\s:])-m-\d/.test(code(file)),
    );

    expect(offenders.map(rel)).toEqual([]);
  });
});

describe('pages compose the landing shell rather than forking it', () => {
  /**
   * The reason this guardrail exists: `/why` was written days after the
   * landing primitives landed and re-forked the shell and hero class strings
   * character-identically, because `LandingHero` required a `trust` prop it
   * had no facts for. Guarding the fixed regressions is not enough; the
   * strings that define the shell have to be unforkable too.
   */
  const OWNED_STRINGS: {label: string; pattern: RegExp; owner: string}[] = [
    {
      label: 'the landing page shell',
      pattern: /landing-lanes w-full max-w-4xl/,
      owner: 'components/landing/LandingPage.tsx',
    },
    {
      label: 'the landing hero title',
      pattern: /max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl/,
      owner: 'components/landing/LandingHero.tsx',
    },
  ];

  it.each(OWNED_STRINGS)(
    'only $owner writes $label',
    ({pattern, owner}: {pattern: RegExp; owner: string}) => {
      const writers = files.filter(file => pattern.test(code(file)));

      expect(writers.map(rel)).toEqual([owner]);
    },
  );
});

describe('shared landing primitives have one definition', () => {
  /**
   * `ExternalLink` was defined character-identically in both tool landing
   * pages before plan 0099. There is now one in
   * `components/landing/ExternalLink.tsx`, and pages import it.
   *
   * `lucide-react` also exports an icon called `ExternalLink`; importing that
   * is unrelated and allowed, so only local declarations count.
   */
  it('declares ExternalLink exactly once', () => {
    const declarations = files.filter(file =>
      /(?:function|const)\s+ExternalLink\b/.test(code(file)),
    );

    expect(declarations.map(rel)).toEqual([
      'components/landing/ExternalLink.tsx',
    ]);
  });
});
