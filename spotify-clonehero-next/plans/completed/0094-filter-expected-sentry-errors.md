# Filter Expected Sentry Errors

## Goal

Keep high-volume expected user flows and recoverable local scan failures from
creating Sentry issues without hiding unrelated failures.

## Work

- Added a narrowly matched client-event filter for picker cancellation, Spotify
  history folder validation, unauthenticated/country-unavailable Spotify states,
  and known File System Access permission outcomes.
- Stopped explicitly capturing recoverable per-directory and per-SNG scan skips.
- Added focused tests covering accepted and rejected event signatures.
- Resolved the nine Sentry groups addressed by these changes, covering 96
  existing events.

## Verification

- Three focused Jest suites pass with 25 tests.
- Scoped `tsgo` and `tsc` checks pass for the Sentry client and event filter.
- ESLint, Prettier, and `git diff --check` pass for the changed files.
- All nine targeted Sentry groups were fetched after resolution and report
  `resolved`; the similar insufficient-scope OAuth defect was excluded.
- Repository-wide type-checking is currently blocked by the unrelated
  in-progress `FIND_MUSIC_RECOMMATIONS_PATH` typo in
  `app/find-music/routes.ts`.
