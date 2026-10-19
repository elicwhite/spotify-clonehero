# 0161 — Block boundary

Make the reusable blocks (highway renderer, sheet music, chart-edit, tempo-map,
ML models) live behind a clean boundary. This is step 1 of a later move to a
pnpm workspace (`packages/core` + `apps/site` + private apps): private
experiments must be able to import the blocks without importing a site route.

Step 1 changes no behavior. It moves files, updates every importer directly
(no re-export shims), and adds a lint rule so the boundary stays.

## The boundary

- `lib/` is the block layer. It does not import `app/` or `components/`.
- `app/<route>/` is one route. It imports `lib/`, `components/`, the app shell
  files at the root of `app/` (providers, layout helpers), and its own files.
  It does not import another route.
- `components/` is shared UI. It does not import a route. It may still import
  the app shell (`app/AudioProvider`, see Follow-ups).

## Moves

Leaks from `lib/` into `components/`:

| From                                             | To                                            |
| ------------------------------------------------ | --------------------------------------------- |
| `components/chart-editor/{commands,scope,capabilities}.ts` | `lib/chart-editor-core/`            |
| `components/chart-editor/__tests__/fixtures.ts`  | `lib/chart-editor-core/__tests__/fixtures.ts` |
| `ProcessingStep` in `components/processing/StepRow.tsx` | `lib/assist/steps.ts`              |
| `components/landing/lanes.ts`                    | `lib/landing/lanes.ts`                        |
| `components/onnx/webgpu-block.ts`                | `lib/onnx/webgpu-block.ts`                    |

All five are pure TypeScript with only `lib/` and package imports, so they
are block code that sat in the wrong folder.

Shared code inside a route that other routes import:

| From                                                   | To                                     |
| ------------------------------------------------------ | -------------------------------------- |
| `app/sheet-music/[slug]/{SheetMusic,NoteFeedbackOverlay,Playhead}.tsx`, `renderVexflow.ts`, `convertToVexflow.ts`, `cleanLyrics.ts`, `notation/` | `lib/sheet-music/` |
| `app/sheet-music/[slug]/CloneHeroRenderer.tsx`         | `lib/preview/CloneHeroRenderer.tsx`    |
| `app/songSlug.ts`, `app/buildSheetMusicUrl.ts`, `app/karaoke/buildKaraokeUrl.ts` | `lib/song-urls/` |
| `app/drum-transcription/components/EditorApp.tsx`      | `components/chart-editor/EditorApp.tsx` |
| `app/drum-transcription/components/AudioUploader.tsx`  | `components/AudioUploader.tsx`         |
| `app/tempo/landing/BeatGridCanvas.tsx`, `app/drum-transcription/landing/EditPassCanvas.tsx` | `components/landing/` |
| `app/add-lyrics/landing/syllableAlignModel.ts` | `lib/landing/` |
| `app/auth/spotifyScopes.ts` | `lib/spotify-sdk/` |
| `app/api/spotify/store-tokens/storeSpotifyToken.ts` | `lib/spotify-server/` |
| `app/storage/routes.ts`                                | `lib/storage-routes.ts`                |
| `app/account/actions.ts`                               | `lib/supabase/accountActions.ts`      |

Tests move with the module they test. The chart-editor command tests that
import only `lib/` move to `lib/chart-editor-core/__tests__/`. The
`components/chart-editor` barrel stops re-exporting `lib/chart-editor-core`;
its two callers import from `lib/` directly. The `/privacy` case of the
editor layout test moves to `app/privacy/__tests__/`.

## Lint rule

`import/no-restricted-paths` (from `eslint-plugin-import`, already loaded by
`eslint-config-next`) in `eslint.config.mjs`. It resolves `@/` and relative
specifiers, so `../other-route/x` is caught as well as `@/app/other-route/x`.

- Zone: target `lib`, from `app` and `components`.
- Zone: target `components`, from every route directory (the app shell at
  the root of `app/` stays allowed).
- One zone per top-level directory of `app/` (read at config load): target
  that directory, from every other top-level directory. `app/__tests__` tests
  the app shell and is not a route; it is not a target.

## Tooling

A one-off codemod (scratch, not committed) does each move: `git mv`, then
rewrites every import, `import()`, `jest.mock()` and `require()` specifier
that resolves to a moved file. Relative specifiers stay relative; `@/`
specifiers stay `@/`. `jest.mock()` must stay relative: next/jest rewrites
`@/` in imports only.

## Done when

- `eslint .` passes with the new rule.
- `tsgo --noEmit` and jest pass.
- `/sheet-music/<slug>`, `/drum-fills`, `/tempo-viewer`, `/chart-editor`,
  `/tempo`, `/chart` still render.

## Follow-ups

- `components/` imports `app/AudioProvider` (music preview). Move the
  provider out of `app/` before `components/` joins `packages/core`.
- Decide which of `components/` is block (chart-editor, highway UI) and which
  is site (landing, nav), then split before the workspace move.
