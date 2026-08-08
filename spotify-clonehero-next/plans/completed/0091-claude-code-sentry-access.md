# Claude Code Sentry Access

## Goal

Give Claude Code project-scoped, authenticated access to the existing Sentry
project without committing API credentials.

## Work

- Added Sentry's official remote MCP service to the shared project config.
- Documented the Sentry organization/project and the one-time OAuth flow for
  Claude Code.
- Validated the MCP configuration while preserving the existing Next.js
  DevTools server.

## Verification

- Parsed `.mcp.json` as JSON.
- Confirmed Claude Code recognizes and connects to the project-scoped `sentry`
  MCP server.
- Completed Sentry OAuth authentication through Claude Code.
- Confirmed read access to organization `clone-hero-chart-tools` and project
  `frontend` through a read-only Sentry MCP query.
