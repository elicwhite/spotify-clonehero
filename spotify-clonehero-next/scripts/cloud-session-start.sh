#!/bin/bash
# SessionStart hook for Claude Code cloud sessions (claude.ai/code). It installs
# the pnpm version from package.json's packageManager field, then the
# dependencies. Local sessions exit at once.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

want=$(node -p "require('./package.json').packageManager.split('@')[1]")
have=$(pnpm --version 2>/dev/null || echo none)
if [ "$have" != "$want" ]; then
  npm install -g "pnpm@$want" >&2
fi

pnpm install --frozen-lockfile >&2
