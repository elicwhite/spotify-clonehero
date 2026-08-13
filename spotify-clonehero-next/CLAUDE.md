# Music Charts Tools (spotify-clonehero-next)

Always talk in ASD-STE100 Simplified Technical English.

Next.js 16 app of browser-based Clone Hero chart tools. Everything runs
client-side; there is no application backend beyond Supabase auth.

```bash
pnpm install
pnpm dev          # dev server
pnpm test         # Jest
pnpm typecheck    # tsgo
pnpm lint         # ESLint + Prettier
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

All work follows the plan-driven workflow in `plans/`. Find or create a plan in
`plans/todo/` before writing code, claim it by moving it to `in-progress/` (one
at a time), and move it to `completed/` when done. The `claim-plan` and
`complete-plan` skills run those steps.

## Skills

Load the skill for what you are doing; each one links onward to its own detail.

| Doing                                                                     | Skill                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------- |
| Choosing a library, bumping the typechecker, introspecting the dev server | `architecture`                                           |
| Anything that sounds like a generic helper                                | `existing-utilities`                                     |
| Any page, section, hero, table, social card, or page gutter               | `design-system` (routes to `landing-pages`, `og-images`) |
| Working in `app/drum-transcription` or `lib/drum-transcription`           | `drum-transcription`                                     |
| Needing real chart-format or game behavior                                | `reference-projects`                                     |
| Verifying UI in the browser                                               | `validate`, `test-interaction`, `check-opfs`             |
| Chart serialization correctness                                           | `verify-chart-roundtrip`                                 |
| The Chorus catalog crawl and client load                                  | `chart-database`                                         |
| Moving code into a shared `lib/`                                          | `extract-utility`                                        |
| Starting or finishing a plan                                              | `claim-plan`, `complete-plan`                            |
| A strict maintainability review                                           | `thermo-nuclear-code-quality-review`                     |
