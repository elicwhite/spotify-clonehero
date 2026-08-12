---
name: architecture
description: The Music Charts Tools stack and its dev tooling — Next.js 16 App Router, React 19, Tailwind + shadcn/ui, SQLocal/Kysely over OPFS, Supabase auth, scan-chart and parse-sng, THREE.js highway, VexFlow, Jest, and the tsgo/tsc typecheck split. Use when choosing a library or pattern, wondering what is already available before adding a dependency, bumping or debugging the typechecker, or introspecting the running dev server's routes, errors, and logs through the Next.js DevTools MCP.
---

# Architecture

Next.js 16 app with Clone Hero chart tools. Everything runs client-side in the
browser; there is no application backend beyond Supabase auth.

## Stack

| Layer           | Choice                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework       | Next.js 16 (App Router) + React 19 + TypeScript (strict)                                                                                    |
| Package manager | pnpm — 7-day `minimumReleaseAge`; dependency build scripts blocked by default, allowlisted in `pnpm-workspace.yaml` `onlyBuiltDependencies` |
| Styling         | Tailwind CSS + shadcn/ui (Radix primitives in `components/ui/`)                                                                             |
| State           | React `useState` / `useReducer` / context. No state library.                                                                                |
| Database        | SQLocal (SQLite in OPFS) + Kysely                                                                                                           |
| Charts          | `@eliwhite/scan-chart` (parse + write `.chart`/`.mid`), `parse-sng` (parse `.sng`); edit helpers in `lib/chart-edit/`                       |
| 3D preview      | THREE.js highway renderer — `lib/preview/highway/`                                                                                          |
| Audio           | `AudioManager` (`lib/preview/audioManager.ts`) — Web Audio API, multiple stems, speed control                                               |
| Notation        | VexFlow (`app/sheet-music/[slug]/SheetMusic.tsx`)                                                                                           |
| Testing         | Jest                                                                                                                                        |
| Auth            | Supabase                                                                                                                                    |

For where a specific helper already lives, load the **`existing-utilities`**
skill rather than searching.

## Typechecking

`tsgo` (TypeScript 7 native preview, `@typescript/native-preview`) is the
primary checker:

```bash
pnpm typecheck        # tsgo — fast, and what CI runs
pnpm typecheck:tsc    # stable tsc
```

`tsc` remains the peer that Next.js and the editor use, and `next build` still
type-checks with it, so the stable compiler stays on the release path.

`tsgo` is pinned to a dated nightly (`7.0.0-dev.*`) and is exempt from
`minimumReleaseAge`. **When bumping it, run `pnpm typecheck:tsc` to confirm
parity before committing** — the two compilers can disagree, and only the
stable one gates the build.

The repo compiles with `exactOptionalPropertyTypes: true`. You cannot pass a
possibly-`undefined` value to an optional property; spread it conditionally
instead:

```ts
...(note !== undefined ? {note} : {})
```

## Introspecting the running app

Next.js 16 exposes a DevTools MCP server, default-on while `pnpm dev` runs, at
`http://localhost:3000/_next/mcp` (stateless streamable-HTTP JSON-RPC).
`.mcp.json` wires it to coding agents through the official `next-devtools-mcp`
bridge, which auto-discovers the running dev server.

Tools: `get_routes`, `get_errors`, `get_logs`, `get_page_metadata`,
`get_project_metadata`, `get_server_action_by_id`.

Use it to answer "what routes exist" or "why did that build fail" without
grepping. For _visual_ verification and interaction testing, use the
chrome-devtools MCP instead — the `validate` and `test-interaction` skills
cover that.
