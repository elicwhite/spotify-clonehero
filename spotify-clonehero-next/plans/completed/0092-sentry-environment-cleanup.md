# Sentry Environment Cleanup

## Goal

Stop local development errors from reaching Sentry, keep production and Vercel
preview events in distinct environments, and resolve existing issue groups that
contain development events only.

## Work

- Centralized Vercel-to-Sentry environment detection with development as the
  safe fallback.
- Applied the environment and enabled state to client and server Sentry setup.
- Added focused tests for production, preview, and local/unknown environments.
- Resolved all 23 Sentry issue groups verified as development-only.

## Verification

- Focused Jest suite passes with 7 tests.
- Both `pnpm typecheck` and `pnpm typecheck:tsc` pass.
- Prettier and `git diff --check` pass for the changed files.
- Post-resolution Sentry queries report zero unresolved development issues,
  all 23 targets resolved, and none of those targets unresolved in production
  or preview.
- The repository-wide build reached 3,695 passing tests but stopped on the
  unrelated in-progress `FindMusicTable` assertion in
  `app/find-music/__tests__/FindMusicTable.test.tsx` before Next.js compilation.
- A direct `next build` remained in Turbopack's compile phase without output
  and was canceled after the focused compile-time checks had already passed.
