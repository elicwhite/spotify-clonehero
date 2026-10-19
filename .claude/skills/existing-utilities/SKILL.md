---
name: existing-utilities
description: Catalogue of what this project already provides so you reuse it instead of reimplementing — chart parsing and editing, tick/ms conversion, OPFS file helpers, audio playback, the 3D highway renderer, sheet-music notation, INI parsing, UI components, landing-page primitives, OG image system, page chrome, class merging, and toasts. Use this before writing any helper that sounds generic (parsing a chart, converting ticks to milliseconds, reading or writing a file in OPFS, playing audio, rendering a highway, merging class names) and before adding a dependency, since the thing you need very likely already exists here.
---

# Existing utilities — reuse, don't reimplement

Check here before writing a helper. Most "I just need a small function for
this" needs are already solved, and a second implementation is how the codebase
grows two of everything.

| Need                                                                                                   | Location                                                                                                                 |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Chart parsing + writing, types (`NoteEvent`, `noteTypes`, `noteFlags`, `ChartDocument`, `ParsedChart`) | `@eliwhite/scan-chart`                                                                                                   |
| Chart edit helpers (`addDrumNote`, `addSection`, `addTempo`), `readChart` wrapper                      | `packages/core/src/chart-edit/`                                                                                          |
| SNG parsing                                                                                            | `parse-sng`                                                                                                              |
| Tick → ms conversion                                                                                   | `packages/core/src/chart-utils/tickToMs.ts` → `tickToMs()`                                                               |
| Drum note → VexFlow notation                                                                           | `packages/core/src/sheet-music/convertToVexflow.ts`                                                                      |
| OPFS file read/write                                                                                   | `packages/core/src/fileSystemHelpers.ts`                                                                                 |
| Audio playback (primary)                                                                               | `packages/core/src/preview/audioManager.ts`                                                                              |
| Highway 3D renderer                                                                                    | `packages/core/src/preview/highway/` (`setupRenderer`, `setupStage`) + `packages/core/src/preview/CloneHeroRenderer.tsx` |
| Sheet music notation                                                                                   | `packages/core/src/sheet-music/SheetMusic.tsx`                                                                           |
| INI parsing                                                                                            | `packages/core/src/ini-parser.ts`                                                                                        |
| UI components                                                                                          | `packages/core/src/components/ui/` (shadcn: Button, Dialog, Card, Select, Slider, …)                                     |
| Landing / marketing page structure                                                                     | `packages/core/src/components/landing/` — load the **`landing-pages`** skill                                             |
| Open Graph images (frame, palette, type scale)                                                         | `packages/core/src/og/` — load the **`og-images`** skill                                                                 |
| Page header + outer gutter                                                                             | `packages/core/src/components/SiteChrome.tsx` → `ROUTE_CHROME` — load the **`design-system`** skill                      |
| CSS class merging                                                                                      | `packages/core/src/utils.ts` → `cn()`                                                                                    |
| Toasts                                                                                                 | `sonner` (configured in root layout)                                                                                     |

## When something exists but is in the wrong place

If the utility you need is buried in a page rather than a shared `packages/core/src/`, do not
copy it and do not import across pages. **Extract it first, in its own commit,
updating the original callsite** — then use it from the new code. The
`extract-utility` skill walks through that.

Splitting the extraction from the feature keeps the extraction reviewable as a
behavior-preserving move, which is the only way anyone can tell it was one.

## Related skills

- **`design-system`** — page structure, landing primitives, OG cards, page chrome.
- **`extract-utility`** — the extract-then-use workflow.
- **`architecture`** — what the stack provides and which libraries are already in.
