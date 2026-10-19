#!/bin/bash
# Launch Chrome with remote debugging for chrome-devtools-mcp
# Run this before starting Claude Code with the sandbox enabled
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-profile-stable
