# apps/\_template

The scaffold of every app in this workspace. It is not a workspace member
(`pnpm-workspace.yaml` excludes it), so `pnpm install` does not install it.

## Make an app

```bash
pnpm new-app my-experiment --port 3060   # without --port: the next free port from 3050
pnpm install                             # links the new app into the workspace
pnpm --dir apps/my-experiment dev
```

The script copies this folder to `apps/<name>` and replaces `__APP_NAME__` and
`__APP_PORT__`. The result type-checks, lints and builds as it is.

## What the scaffold has

- `package.json`: `@musiccharts/core` as `workspace:*`, the Next, React and
  Tailwind versions of `apps/site`, and the scripts `dev`, `build`, `start`,
  `typecheck`, `lint`, `format` and `test`.
- `next.config.js`: compiles core (`transpilePackages`), starts Turbopack and
  the file tracer at the workspace root, and sets the cross-origin isolation
  headers from `@musiccharts/core/next/headers.js`.
- `tsconfig.json`: the `@/*` and `@musiccharts/core/*` paths, and core's
  ambient types (`packages/core/types`).
- `tailwind.config.js` and `app/globals.css`: the shared theme. The tokens come
  from `@musiccharts/core/styles/theme.css` and the preset from
  `@musiccharts/core/styles/tailwind-preset.js`. Change the design system in
  core, not in an app.
- `app/layout.tsx`: a root layout with no site chrome.
- `eslint.config.mjs`: an app imports no other app, and a route imports no
  other route.
- `jest.config.js`: Jest with the same two path maps.
- `public/assets`, `public/soundtouch-worklet.js`, `public/mic-capture-worklet.js`:
  symlinks into `apps/site/public`, because core blocks load these files by URL
  (see `packages/core/README.md`). An app that needs the models or data files of
  the site adds its own symlinks.

## Rules

- Share code by moving it into `packages/core`, never by importing another app.
- Core imports no app.
- Keep an experiment's own files (data, plans, scripts) inside its folder.
