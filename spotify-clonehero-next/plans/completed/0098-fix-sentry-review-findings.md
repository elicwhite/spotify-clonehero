# Fix Sentry Review Findings

## Goal

Resolve each remaining thermo-nuclear Sentry cleanup finding as an isolated,
well-tested, independently reviewed commit.

## Commit Sequence

1. Preserve Spotify caches for unauthenticated and unavailable refresh outcomes.
2. Preserve indexed charts when a filesystem scan is incomplete.
3. Acquire picker choices before launching cancellable parallel work.
4. Separate download cancellation from invalid HTTP responses and emit analytics
   only after successful installation.

## Quality Gate Per Commit

- Add focused behavioral tests before or alongside the implementation.
- Run affected tests, both TypeScript checkers where the concurrent worktree
  permits, ESLint, Prettier, and `git diff --check`.
- Run a read-only Sol thermo-nuclear review of the isolated diff.
- Address blocking review findings before committing.
- Stage only that issue's files and exclude concurrent Apple Music work.

## Outcome

All four findings were implemented as reviewed commits. The final behavior now
preserves Spotify caches and local chart indexes across unavailable or partial
refreshes, gates background work behind required picker choices, and treats
download cancellation as a typed non-error outcome while preserving real
download failures.
