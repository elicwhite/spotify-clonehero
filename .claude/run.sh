#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$(cd "$DIR/.." && pwd)"
CLAUDE="$(which claude 2>/dev/null || echo "$HOME/.local/bin/claude")"
exec sandbox-exec -f "$DIR/sandbox.sb" -D HOME="$HOME" -D PROJECT="$PROJECT" "$CLAUDE" --allow-dangerously-skip-permissions "$@"
