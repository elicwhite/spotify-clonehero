# 0058 — /preview: support charts without a drum track

## Problem

The /preview route refuses to load any chart that has no drums track:

- `app/preview/Search.tsx` (`loadEncoreChart`) throws
  "No drum track found in this chart" for Encore charts (reachable via
  `?md5=` deep links, which bypass the drums search filter).
- `components/chart-picker/LocalChartLoader.tsx` toasts the same error
  and bails for local charts.

The editor shell itself is already null-safe for a missing scoped track
(`chartToElements` skips notes when `track` is null and still emits
markers; the highway renders the beat grid from the tempo map), so a
drum-less chart should preview fine — beat grid only, no notes.

## Approach

- `LocalChartLoader`: add a `requireDrums?: boolean` prop (default
  `true`, matching the current behavior for /sheet-music, which
  genuinely needs a drums track). /preview passes
  `requireDrums={false}`.
- `app/preview/Search.tsx`: drop the drums-track throw in
  `loadEncoreChart`; pass `requireDrums={false}` to the local loader.
- Keep the drums instrument filter on the Encore search list for now.
  Instrument selection for preview is future work.

## Validation

- Unit test: `computeChartElements` under the drums/expert scope on a
  chart with no drums track returns markers only, no throw
  (`useChartElements.test.ts`).
- `pnpm typecheck` clean for touched files; eslint clean; /preview
  compiles and serves 200 with no Next DevTools session errors.
- In-browser check with a real non-drum chart (local .sng or `?md5=`
  deep link) still pending — no debug-port Chrome / extension bridge
  was reachable from this session.
