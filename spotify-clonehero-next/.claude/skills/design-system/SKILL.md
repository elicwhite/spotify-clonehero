---
name: design-system
description: Entry point for the Music Charts Tools design system — the shared landing-page primitives, the Open Graph image system, and the per-route page shell and gutter rules. Use this whenever building or restyling any page, section, hero, comparison table, social/OG card, or page shell in this repo, and whenever a page needs a different outer gutter or full-bleed layout. Also use it before adding a new route, since new pages are where forked copies of the shell get introduced. Start here when you are not sure which of the landing-pages or og-images skills applies.
---

# Design system

This repo has a real design system. Most of what looks like "a bit of layout
you need to write" already exists as a component, and the class strings that
define the page shell are owned by exactly one file each.

**Why this matters more than the usual "please reuse things".** The system was
built by consolidating four dialects of the same landing page and ten
hand-rolled OG cards. Within four days of it landing, a new page (`/why`) was
written that re-forked the shell and hero class strings character-identically,
because one prop it did not need was required. Forking is the default failure
here, and it happens to careful people. That is why tests now fail on it.

## Route by task

Read only what your task needs.

| You are…                                                                                                         | Load                                                                                        |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Building or editing a marketing / tool landing page, hero, section, comparison table, or trust line              | the **`landing-pages`** skill                                                               |
| Adding or editing an `opengraph-image.tsx`, or touching brand colours, gradients, or type sizes on a social card | the **`og-images`** skill                                                                   |
| Changing a page's outer gutter, or making a page full-bleed                                                      | `references/page-shells.md`, "The gutter contract" — the answer is one `ROUTE_CHROME` entry |
| Working on a dashboard shell, or the editor's compact density tokens                                             | `references/page-shells.md`, "Density" and "Dashboard layouts"                              |
| Wondering why one page deliberately differs from another                                                         | `../docs/design-system-audit.md` — every difference has a recorded verdict                  |
| Adding a rule, or wondering what stops drift                                                                     | `references/guardrails.md`                                                                  |

If you are about to write a container `<div>` with a `max-w-*` and vertical
rhythm on it, stop and load `landing-pages` first. That div almost certainly
already exists.

## The three things that are always true

**1. Compose, don't fork.** A new page composes existing primitives. If a
primitive is close but not right, change the primitive or add a documented
variant — do not copy its markup into a page. When a prop blocks reuse, making
that prop optional is nearly always the better fix than forking. This is not
style advice; `components/__tests__/design-system-guardrails.test.ts` fails the
build if the shell or hero class strings appear outside
`components/landing/`.

**2. Two documents govern, and they do not overlap.**

- `../docs/landing-page-style-guide.md` governs **copy** — what a page may say,
  which claims need a source, which phrases are banned.
- `../docs/design-system.md` governs **structure** — which component to reach for,
  which tokens exist, what each documented variant means.

Some components encode a copy rule, so a change in one may need a change in the
other. `TrustLine` exists because §7 says trust signals are stated and not
decorated. `ComparisonTable` has no verdict slot because §5.2 forbids a verdict
sentence — the absence is the enforcement.

**3. A migration is a visual no-op unless the audit says otherwise.** If you
are consolidating rather than redesigning, the bar is that the page renders
identically. `references/verifying-changes.md` has the procedure that actually
works here, including the two traps that make naive screenshot diffing lie.

## Before you finish

Run `pnpm test`, `pnpm typecheck`, and `pnpm lint`. The guardrail suites are
cheap and they encode real regressions, not opinions:

```bash
pnpm jest components/__tests__/design-system-guardrails lib/og components/landing
```
