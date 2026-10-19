# @musiccharts/core

The shared blocks of the Music Charts apps: the highway renderer, chart
editing, the tempo map, sheet music, the ML pipelines, and the shared UI. It
ships TypeScript source and has no build step.

## Use it from an app

- Add `"@musiccharts/core": "workspace:*"` to the app's package.json.
- Add `transpilePackages: ['@musiccharts/core']` to `next.config.js`.
- Add a tsconfig path: `"@musiccharts/core/*": ["../../packages/core/src/*"]`,
  and include `../../packages/core/src` so the type check covers it.
- Include `../../packages/core/types/**/*.d.ts` in the tsconfig. Those files
  declare the browser globals core relies on (`Window` extras, `navigator`
  extras, `ImageDecoder`, React attributes).
- Add `../../packages/core/src/**/*.{ts,tsx}` to the Tailwind `content`.
- Import by subpath: `import {setupStage} from '@musiccharts/core/preview/highway'`.
- For Jest, map `^@musiccharts/core/(.*)$` to `<core>/src/$1`.

Inside core, import with relative paths. The `@/` alias points at the app, so
ESLint forbids it here. Core does not import any app.

## Files the app must serve

Core code loads these files by URL, so each app that uses a block serves them
from its own `public/` folder. `apps/site/public/` is the reference copy.

| URL                                                                                            | Used by                                                                                            |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/assets/preview/assets/...`, `/assets/preview/assets2/...`                                    | the highway renderer (`preview/`): textures, frets, flames, sustains                               |
| `/assets/instruments/<instrument>.png`                                                         | instrument icons in the chart UI                                                                   |
| `/assets/apple-music/...`                                                                      | the Apple Music icons                                                                              |
| `/soundtouch-worklet.js`                                                                       | the audio player (`preview/audioManager`)                                                          |
| `/mic-capture-worklet.js`                                                                      | the microphone capture of sheet-music follow                                                       |
| `/models/crnn_stereo_256mel_<version>.onnx` and `crnn_stereo_256mel.<version>.thresholds.json` | drum transcription; the `.onnx` is loaded from here in development only, and from R2 in production |
| `/models/linkseg_7c.onnx`                                                                      | section names, in development only; production reads R2                                            |
| `/models/drum-difficulty/v5/*`                                                                 | drum difficulty generation                                                                         |
| `/data/guitar-difficulties/guitar-reduction-e101baa.json`                                      | guitar difficulty generation                                                                       |

Other models (BS-RoFormer, Demucs, wav2vec2, beat_this) load from Hugging Face
or R2 and need nothing from the app.

The pages that use SQLocal or SharedArrayBuffer also need the cross-origin
isolation headers (`Cross-Origin-Embedder-Policy: credentialless` and
`Cross-Origin-Opener-Policy: same-origin`) from the app's `next.config.js`.
