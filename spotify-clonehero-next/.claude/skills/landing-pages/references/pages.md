# Which pages are in the system, and which are deliberately not

Read this before assuming a page should be migrated. Every difference below is
a recorded decision in `../docs/design-system-audit.md`, not an accident — and
"different, keep" rows are part of the system, not debt.

## In the system

| Page                                         | File                                                             | Notes                                                                                                                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/drum-transcription`                        | `app/drum-transcription/landing/DrumTranscriptionLanding.tsx`    | The fullest example: hero with canvas, tool entry, `StepFlow`, a `CardGrid` fixes grid, and a two-group `ComparisonTable` with summary rows.                                                   |
| `/tempo`                                     | `app/tempo/landing/TempoLanding.tsx`                             | The smaller example. Exercises the intro-only `LandingSection` and a single-group peer-measurement table.                                                                                      |
| `/add-lyrics`                                | `app/add-lyrics/landing/AddLyricsLanding.tsx`                    | Hero canvas, tool entry, `StepFlow`, and a `LandingProse` credit line. No comparison table.                                                                                                    |
| `/drum-difficulties`, `/guitar-difficulties` | `components/difficulty-generation/landing/DifficultyLanding.tsx` | One shared layout for two routes. Each route's client (`app/<route>/<Name>Client.tsx`) supplies the copy; the shared file owns the structure, the shared-verbatim section titles, and the CTA. |
| `/why`                                       | `app/why/WhyPage.tsx`                                            | A position page, not a tool page: `LandingHero` with no `trust`, and no tool entry.                                                                                                            |

After migration these files hold content and nothing structural — step copy,
failure-mode copy, their canvases, and the metrics they import. The difficulty
routes invert that split once more: `DifficultyLanding` holds the structure
one time, and each route's client holds only its copy.

## Deliberately outside

### `/find-music`'s welcome (`app/find-music/FindMusicWelcome.tsx`)

Marketing content **embedded in a dashboard**. It renders inside a scroll pane,
next to a sidebar, beneath the page's own `h1`, so it keeps:

- its own `h2` heading scale and `max-w-5xl` measure
- its own section rhythm, with small `h3` headings and no hairline rules

`LandingSection`'s visible rules and larger headings would fight the sidebar
context. The marketing system deliberately did **not** grow a `compact` variant
on speculation.

What it _did_ adopt is the trust treatment — `Eyebrow` and `TrustLine` — because
its bordered `LockKeyhole` pill and `ShieldCheck` callout violated style-guide
§7. The words and their positions are unchanged; only the badge chrome and the
two icons went.

`SetupCard`, `OutcomePanel` and `StatusDot` in that file are dashboard
source-status components, not marketing components. If they ever move, it is to
a dashboard namespace, not `components/landing/`.

### `/sng` (`app/sng/components/SngLanding.tsx`)

A utility page. It is not in the copy style guide's scope list, has no trust,
measurement, or comparison content, and its shadcn `Card` action grid has no
counterpart in the landing system. Revisit only if it grows marketing content.

Its OG card _is_ in the OG system — Track A covered every route.

## The lesson from `/why`

`/why` was written days after the primitives landed and re-forked the shell and
hero class strings character-identically. It had already imported `Eyebrow` and
`LandingSection`, so the intent to reuse was there. What blocked it was a
required `trust` prop it had no facts for — so it forked the hero, and having
forked the hero, forked the shell too.

Two things came out of that:

- `trust` is optional now.
- A guardrail test fails if the shell or hero class strings appear outside
  `components/landing/`.

When a required prop blocks reuse, **make it optional**. That is almost always
cheaper than the fork, and the fork is what the system exists to prevent.
