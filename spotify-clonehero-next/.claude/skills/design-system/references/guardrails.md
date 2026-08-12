# Guardrails

Three suites hold the system together. They are deliberately narrow: each one
names something that actually went wrong and got fixed, so a failure is a real
regression rather than a style opinion. A broad rule ("no arbitrary Tailwind
values") would fight this codebase and get disabled within a release.

```bash
pnpm jest components/__tests__/design-system-guardrails lib/og components/landing
```

## `components/__tests__/design-system-guardrails.test.ts`

Scans `app/`, `components/`, and `lib/`, with comments stripped — a doc comment
explaining a removed hack is documentation, not a reintroduction.

| Rule                                                     | What it catches                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| No `w-[calc(100%+…)]`                                    | A page widening itself to undo a parent gutter.                                                                    |
| No all-sides negative margin (`-m-4`, `sm:-m-4`)         | A container escaping its parent. Directional nudges like `-mx-1` are legitimate optical alignment and are allowed. |
| One `ExternalLink` declaration                           | The primitive that was defined character-identically in two pages.                                                 |
| Only `LandingPage.tsx` writes the shell class string     | A page forking the shell.                                                                                          |
| Only `LandingHero.tsx` writes the hero `h1` class string | A page forking the hero.                                                                                           |

The last two exist because guarding only the _already-fixed_ regressions was
not enough — `/why` forked the shell days after the system landed and nothing
caught it.

## `lib/og/__tests__/og-routes.test.ts`

Discovers every `opengraph-image.tsx` under `app/` and checks each one exports
`OG_SIZE` as `size`, a non-empty `alt`, `image/png`, and a default function.

There is deliberately **no hardcoded file count**. One used to be here and was
pure maintenance tax — it asserted nothing the per-file cases don't, and adding
a card meant editing a number in an unrelated file.

It also fails if a route re-declares the old brand gradient or a page-local
lane palette, and pins `OG_LANES` and `LANE_FALLBACKS` to the `.landing-lanes`
dark block by **parsing `app/globals.css`**. An earlier version compared the two
TypeScript constants to each other, which would have stayed green while both
drifted away from the stylesheet together.

## `components/landing/__tests__/`

Component contracts: heading levels, `aria` wiring, `ComparisonTable` row
groups and group separators, the intro-only `LandingSection`, the empty-slot
cases, and `ScrollToStartCta`'s scroll target.

## Adding a rule

Keep it narrow and name a real regression. A useful test:

- Can you point at the commit where this actually went wrong?
- Would it fail on that commit and pass now?

**Verify both directions.** A guardrail that never fails is worse than none —
it reads as coverage while asserting nothing. Inject the regression, watch the
test fail, revert, watch it pass. Two of the original rules in this suite
looked fine and were checked this way afterwards: one regex missed
responsive-prefixed forms entirely, and the lane test compared two constants
that could drift together.
