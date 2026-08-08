# Handle Expected Outcomes at Source

## Goal

Replace the global expected-error Sentry filter with non-exceptional results and
local handling at the picker, Spotify-history, authentication, availability,
and scan emission sites.

## Work

- Removed the client `beforeSend` expected-error filter and its matcher.
- Return picker cancellation from local chart scanning and downloads instead of
  throwing, while continuing to reject unexpected picker failures.
- Return Spotify-history validation failures as data and render them locally.
- Treat a missing Spotify token as an unavailable SDK rather than an exception.
- Handle country-unavailable Spotify library endpoints locally while preserving
  other OAuth failures.
- Keep recoverable scan skips as local warnings rather than explicit captures.

## Verification

- Six focused Jest suites passed (24 tests).
- Scoped `tsgo` and `tsc` checks passed for the affected production modules.
- ESLint, Prettier, and `git diff --check` passed for the affected files.
- Repository-wide `tsgo` and `tsc` checks are blocked by the unrelated existing
  `FIND_MUSIC_RECOMMATIONS_PATH` typo in `app/find-music/routes.ts`.
