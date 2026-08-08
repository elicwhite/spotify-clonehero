# Preserve Spotify Refresh Async Contract

## Goal

Fix Spotify refresh Promise settlement without changing its fire-now,
observe-progress, await-later behavior.

## Work

- Added characterization coverage for immediate Promise return, caller
  interleaving, progress while pending, eventual success, and rejection
  propagation.
- Replaced the unsafe async Promise executor with an explicitly returned async
  work Promise.
- Preserved the existing refresh concurrency, progress, caching, and caller
  contract.

## Verification

- The success characterization passed against the original implementation.
- The failure characterization reproduced the original hanging Promise, then
  passed after the Promise plumbing change.
- Four focused Jest suites passed (12 tests).
- ESLint, Prettier, and `git diff --check` passed for the affected files.
- Repository-wide `tsgo` and `tsc` checks are blocked by unrelated existing
  errors in `app/find-music/routes.ts` and concurrent Apple Music work.
