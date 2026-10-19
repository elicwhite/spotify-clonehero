# Music Charts Tools (apps/site)

Always talk in ASD-STE100 Simplified Technical English.

This repo is a pnpm workspace. The site is `apps/site/`. The shared blocks
and the shared UI are the package `@musiccharts/core` in `packages/core/src/`
(`lib/` and `components/` of the site moved there). Apps import it as
`@musiccharts/core/<path>`. Inside core, imports are relative: the `@/` alias
is forbidden there. Paths in this file, in the skills, and in the plans are
relative to `apps/site/` unless they start with another root folder
(`packages/core/`, `videos/`, `docs/`, `.claude/`). Plans written before the
move say `lib/x` for `packages/core/src/x` and `components/x` for
`packages/core/src/components/x`.

Next.js 16 app of browser-based Clone Hero chart tools. Everything runs
client-side; there is no application backend beyond Supabase auth.

```bash
pnpm install                  # from the repo root: installs every package
pnpm --dir apps/site dev      # dev server
pnpm test                     # Jest (root script runs each package's test)
pnpm typecheck                # tsgo
pnpm lint                     # ESLint + Prettier
```

## Repo-wide gotchas

- **Nothing is uploaded.** The tool pages promise users their audio and charts
  never leave the browser, so adding a server round-trip to a tool breaks a
  user-facing claim, not just an architectural preference.
- **OPFS, not IndexedDB,** for audio and chart data.
- **React state + context.** No zustand or other state library.
- Comments describe the current state of the code, not how it used to be. A
  comment explaining a change belongs in the commit message.

## Plans

Plans are for large architectural or sweeping changes: new features, refactors
that span many files, or anything that needs design decisions written down.
Small bug fixes and contained changes go straight to a commit, with the reasoning
in the commit message.

For work that does need a plan, follow the workflow in `apps/site/plans/`. Find or create
a plan in `apps/site/plans/todo/` before writing code, claim it by moving it to
`in-progress/` (one at a time), and move it to `completed/` when done. The
`claim-plan` and `complete-plan` skills run those steps.

## Skills

Load the skill for what you are doing; each one links onward to its own detail.

| Doing                                                                         | Skill                                                    |
| ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| Choosing a library, bumping the typechecker, introspecting the dev server     | `architecture`                                           |
| Anything that sounds like a generic helper                                    | `existing-utilities`                                     |
| Any page, section, hero, table, social card, or page gutter                   | `design-system` (routes to `landing-pages`, `og-images`) |
| Working in `app/drum-transcription` or `packages/core/src/drum-transcription` | `drum-transcription`                                     |
| Needing real chart-format or game behavior                                    | `reference-projects`                                     |
| Verifying UI in the browser                                                   | `validate`, `test-interaction`, `check-opfs`             |
| Chart serialization correctness                                               | `verify-chart-roundtrip`                                 |
| The Chorus catalog crawl and client load                                      | `chart-database`                                         |
| Moving code into a shared `packages/core/src/`                                | `extract-utility`                                        |
| Starting or finishing a plan                                                  | `claim-plan`, `complete-plan`                            |
| A strict maintainability review                                               | `thermo-nuclear-code-quality-review`                     |
