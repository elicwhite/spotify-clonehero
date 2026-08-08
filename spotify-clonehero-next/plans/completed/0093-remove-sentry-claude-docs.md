# Remove Sentry Claude Documentation

## Goal

Remove all Sentry-specific content from `CLAUDE.md` without changing the Sentry
integration or MCP configuration.

## Verification

- Confirmed `CLAUDE.md` contains no case-insensitive matches for `sentry`.
- Prettier and `git diff --check` pass for the changed documentation.
