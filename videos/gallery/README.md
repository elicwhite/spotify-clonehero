# gallery

A Remotion project with one composition per kit block, grouped in folders
by area, and the kit's smoke checks. Every block runs on invented material
(a tempo timeline, the kit's test chart, the recorder's self-test page, a
logo sting rendered against an invented timeline), never on song material.

Open it from `videos/` with `pnpm gallery`.

| Folder                      | Blocks                                                                                                                                        | Area                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Core                        | `Core-Clock` and `Core-Clock-Vertical30` (the same film at 60 fps landscape and 30 fps portrait), `Core-Motion`, `Core-Text`                  | clock, music, motion, text measurement ([src/blocks/core](src/blocks/core))   |
| Highway                     | `Highway-Strip`, `Highway-Smoke`, `Highway-Edits`, `Highway-Panel`, `Highway-Plate`, `Highway-Warped`, `Highway-Split`, `Highway-ChartFolder` | the product highway ([src/blocks/highway](src/blocks/highway))                |
| Recorder                    | `Recorder-Take`, `Recorder-FrameCheck`                                                                                                        | recordings of a running page ([src/blocks/recorder](src/blocks/recorder))     |
| Text, Fx, Ui, Brand, Camera | one composition per block                                                                                                                     | the visual areas ([src/blocks/visualBlocks.tsx](src/blocks/visualBlocks.tsx)) |

## Smoke checks

- `Highway-Smoke` fails its render when the product highway draws black or
  out of sync. Rendered with `--props='{"skewFrames":3}'` (telling the check
  its probe note plays 3 frames late) it must fail, which proves the check
  can.
- `Recorder-FrameCheck` shows the whole recorded window on one film frame
  (default 24; `--props='{"filmFrame":30}'` picks any frame of the take), to
  compare with the harness's screenshot of that frame: it measures about
  52 dB PSNR against it and about 24 dB against its neighbour.
- `Core-Clock` says "storyboard on the beat grid" in green, or lists in red
  each scene that drifts off its bar. Its two formats must land every scene
  and beat on the same musical positions.

Render stills of any block with the kit's tools (see
[scripts/render](../kit/scripts/render/README.md)), from `videos/`:

```sh
node --import tsx kit/scripts/render/stills.ts --entry gallery/src/index.ts --film gallery \
  --composition Core-Clock --frames 270 --out gallery/out/stills
```

## Generated inputs (gitignored)

Four blocks read material the kit writes into `public/generated/`, which is
never committed. Regenerate it from `videos/`:

- `Highway-ChartFolder`: the kit's invented test chart, written as files:

  ```sh
  node --import tsx kit/scripts/highway/link-chart.ts --test-chart --out gallery/public/generated/highway
  ```

- `Recorder-Take` and `Recorder-FrameCheck`: the recorder's self-test
  records its test page twice, checks the takes are byte-identical, and
  keeps the first. It needs the recorder's own Chrome (see
  [scripts/recorder](../kit/scripts/recorder/README.md), "Setup"):

  ```sh
  node --import tsx kit/scripts/recorder/selftest.mjs --cdp http://127.0.0.1:<port> \
    --keep gallery/public/generated/rec
  ```

- `Brand-LogoSting`: the kit's Blender logo sting, 120 frames at 60 fps (the
  block's rate) against an invented 120 BPM timeline, so it has a fly-in, an
  impact, four lane flashes, the rest pose and one sheen (a sheen needs
  0.43 s either side of it after the rest pose, hence 2 s rather than less).
  The inputs go to `out/`; the render writes `public/generated/sting/` (the
  PNGs) and `public/generated/sting.json` (the meta the player reads). The
  Blender step takes about 40 s and needs GPU access, so run it outside a
  sandbox that blocks it (see [blender](../kit/blender/README.md)):

  ```sh
  node --import tsx gallery/scripts/stingTimeline.ts --out gallery/out/sting/timeline.json
  node --import tsx kit/blender/stingEvents.ts --timeline gallery/out/sting/timeline.json \
    --length 120 --out gallery/out/sting/events.json
  node --import tsx kit/scripts/brand/write-brand-json.ts --out gallery/out/sting/brand.json
  blender -b --factory-startup --python kit/blender/logo_sting.py -- \
    --events gallery/out/sting/events.json --brand gallery/out/sting/brand.json --size 512 \
    --out gallery/public/generated/sting
  ```

  The player throws when the sting's fps is not the composition's. For a
  block at another rate, render at that rate: `stingTimeline.ts --fps 30`
  and the same 2 s as `--length 60`.

Every other highway block builds the test chart in memory and needs nothing
generated. `public/product` is a committed link to the app's
`public/assets`, the product's own art.
