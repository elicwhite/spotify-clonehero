# 0069 — Complete square + round drum note style sets

## Status: investigation + spec only. Do NOT implement the bake in this plan — a follow-up plan implements `scripts/bake-drum-styles.ts` from this spec.

## Problem

`public/assets/preview/assets2/` ships animated WebP note textures for the
drum highway (128×64, 16 frames, 50ms/frame, looping). The tom set mixes two
distinct Unity art styles instead of being visually consistent:

- `drum-tom-{color}.webp` (base) and `drum-tom-{color}-sp.webp` — **square /
  angular** style (diamond-shaped gem top).
- `drum-tom-{color}-accent.webp` and `drum-tom-{color}-accent-sp.webp` —
  **round** style (circular head, white arrow/cone highlight sweep).
- `drum-tom-{color}-ghost.webp` — **round** style, and **static** (1 frame,
  confirmed via `sharp().metadata().pages === 1`).
- `drum-tom-{color}-ghost-sp.webp` — round style, but **animated** (16
  frames) — a pulsing cyan glow ring around the same round disc.

So today, within one color, `base`/`sp` render square while
`accent`/`accent-sp`/`ghost`/`ghost-sp` render round, and `ghost` alone is a
single frame instead of animated. The goal is two **complete, internally
consistent** style sets — square and round — each with `{base, accent,
ghost, sp}`, all animated, for every drum color, so a renderer-level toggle
(or later a user setting) can pick one style and get uniform art.

## 1. Complete audit of `public/assets/preview/assets2/drum-*.webp`

All confirmed via `sharp(file).metadata()` (`pages` = frame count) and visual
frame dumps (`sharp(file, {page: N}).png()`). All are 128×64 except kick.

| File pattern (× color) | Style (visual) | Frames | Notes |
|---|---|---|---|
| `drum-tom-{color}.webp` | **square** (diamond gem) | 16, animated | base |
| `drum-tom-{color}-sp.webp` | **square** (diamond gem + cyan glow halo) | 16, animated | |
| `drum-tom-{color}-accent.webp` | **round** (white arrow-cone sweep) | 16, animated | |
| `drum-tom-{color}-accent-sp.webp` | **round** + cyan glow | 16, animated | |
| `drum-tom-{color}-ghost.webp` | **round** (dim disc) | **1, static** | gap: not animated |
| `drum-tom-{color}-ghost-sp.webp` | **round** (dim disc) + pulsing cyan glow ring | 16, animated | glow pulses; disc itself does not appear to change shape frame-to-frame |

Colors present: `red`, `yellow`, `blue`, `green` — full 6-file set for each
(24 tom files total). No square accent/ghost variant exists anywhere in
`assets2` today; no round base/sp variant exists either. Confirmed by
listing: `ls public/assets/preview/assets2/drum-tom-*.webp` → exactly the 24
files in the table above (6 per color × 4 colors).

Cymbals (`drum-cymbal-{color}.webp` etc.): `yellow`, `blue`, `green` each
have the same 6-file set (base, sp, accent, accent-sp, ghost [1 frame
static], ghost-sp [16 frame animated]); `red` has **only**
`drum-cymbal-red.webp` (no variants — pro-drums has no red cymbal, matches
`TextureManager.loadCymbalTextures` which excludes red from
`cymbalNoteTypes`, so this is not a gap). Visually, cymbal base/accent/ghost
all share **one consistent dome/bowtie style** — there is no square/round
mixing on cymbals; the Unity source only has one cymbal art style
(`cymbals/Standard`, `cymbals/Accents`, `cymbals/StarNote` — no "square"
cymbal folder exists). **Conclusion: cymbals are already a single complete
style; no bake work needed for cymbals**, except optionally animating their
static `ghost` frame the same way tom ghost is animated (see §3), for
consistency — treat as opportunistic, not required.

Kick (`drum-kick.webp`, `drum-kick-sp.webp`): these are **1024×57 / 1024×53**
(not 128×64) — a full-width strip since the kick note spans the whole
highway rather than a single lane. 16 frames each, animated. Only one visual
style exists in the Unity source (`drum kicks/`, no alternate style folder).
**Conclusion: kick has no style-mixing gap; out of scope for the bake
besides being a straightforward reference for full-width compositing if
ever revisited.**

**Summary of gaps to fill:** only **toms** need work. For each of the 4 tom
colors we need a second, complete, round-styled `{base, sp}` pair (accent
and accent-sp already round) and a square-styled `{accent, accent-sp}` pair
(base/sp already square), plus an **animated** ghost in both styles (today
only a round static ghost and round animated ghost-sp exist — no square
ghost/ghost-sp, and the round ghost needs to become animated).

## 2. Source material map (`/Users/eliwhite/Downloads/Textures/Note_Spritesheets/Drums/`)

All source images are **128×64 PNG, grayscale** (confirmed: R≈G≈B channel
means match within <1 across every file checked, e.g.
`toms/Standard/body.png` → R 201.6 G 201.5 B 201.5). Color in the shipped
`assets2` files is applied by **tinting** the grayscale art (multiply-style
tint per drum color), not baked into the source PNGs. Verified by sampling
raw pixels of `drum-tom-red.webp` frame 0: pixel (41,22) = `rgba(151,109,109,255)`
— R substantially higher than G/B, i.e. a red multiply tint over gray
luminance, consistent with the grayscale source. The bake script must apply
a tint (not assume pre-colored source art).

All layers use standard alpha compositing (`hasAlpha: true`, confirmed via
`sharp().metadata()`), each frame mostly-transparent with the shape drawn in
a sub-region — normal for sprite-on-transparent assets, verified non-blank
via `sharp().stats()` alpha-channel min/max/mean (min 0, max 255, mean
3–125 depending on layer coverage — shine/highlight layers have low mean
because they cover a small bright sliver of the 128×64 canvas, not because
they're empty).

### Round tom (source: `toms/`)

- `toms/Standard/body.png` — static base shape (round drum body), gray.
- `toms/Standard/head.png` — static drum head disc, gray, sits on top of body.
- `toms/Standard/shine00.png` … `shine15.png` — 16-frame animated highlight
  sweep, low alpha coverage, composited **over** body+head. This is the
  "round base, animated" — i.e. round-base = `body` (static) + `head`
  (static) + `shine{NN}` (animated, one of 16 frames per output frame).
  **This is currently unused** — `assets2` has no round base variant, only
  square base.
- `toms/Accents/AcPc01.png` … `AcPc16.png` — 16-frame animated round accent
  (the white arrow/cone sweep seen in `drum-tom-{color}-accent.webp`). This
  is a self-contained animated layer (already what's baked into the shipped
  round accent file) — no separate body+head composite needed, `AcPcNN` is
  the complete frame content for accent.
- `toms/StarNote/0001.png`…`0016.png` — 16-frame star/glow overlay (the
  cyan SP glow ring/spark seen animating in every `-sp` variant).
  `toms/StarNote/body0001.png`…`body0016.png` — 16-frame star-note **body**
  layer variant (looks like a body/head recolor consistent with SP state —
  needs a visual diff pass in the bake script; likely composited underneath
  the `NNNN.png` glow frames the same way `body`+`head` sit underneath
  `shine`). `toms/StarNote/sp_cap.png` — single static cap/highlight layer,
  low alpha coverage (mean 24.5), likely composited on top of every SP frame
  (a fixed highlight, not animated).
- `ghost_tom.png`, `ghost_tom_head.png` — static, dim/desaturated (mean
  alpha and luminance both lower than `Standard/body`+`head`) — this is the
  round-ghost **base** shape source (this is what's currently baked into the
  1-frame static `drum-tom-{color}-ghost.webp`). No animated-ghost-specific
  frames exist in source; the shipped `-ghost-sp.webp` is animated only
  because it composites `ghost_tom(+head)` **under** the same
  `StarNote/NNNN.png` glow-ring animation used for the non-ghost SP variant
  — the ghost disc itself is static across those 16 frames, only the glow
  ring pulses. **Conclusion for animating plain ghost (§3): reuse
  `ghost_tom` + `ghost_tom_head` composited with the round `shine{NN}`
  overlay** (the same shine sweep used for the round base), since there is
  no ghost-specific shine source — this produces a subtle animated highlight
  on the ghost head consistent with how base/accent get their motion, while
  keeping it visually dimmer (lower alpha / desaturated tint) than the
  non-ghost round base.

### Square tom (source: `toms square/`)

- `SQTMBase.png` — static square base outline/rim (gray) — this is the
  "cage" shape seen in `drum-tom-{color}.webp` today (already baked, square
  base already ships).
- `SQTMBody.png` — static square gem/diamond body (gray) — also already
  baked into the shipped square base.
- `SQTMBaseghost.png`, `SQTMBody-Ghost.png` — static, dimmer counterparts of
  the two above (confirmed dimmer via visual inspection: darker gem,
  softened rim) — **this is the missing square-ghost base source**, not yet
  used anywhere in `assets2`.
- `SqTmAc/SqTmAc0.png`…`SqTmAc15.png` — 16-frame animated **square accent**
  (the missing piece — square-styled accent sweep, analogous to
  `toms/Accents/AcPcNN` but angular). Confirmed grayscale, alpha mean 105.7
  (substantial coverage — a full accent shape per frame, self-contained like
  `AcPcNN`).
- `Shines/Sh0.png`…`Sh15.png` — 16-frame animated highlight sweep for the
  square body (low alpha coverage, mean 3.4 — a thin gem-glint sweep),
  composited over `SQTMBase`+`SQTMBody` (or the ghost equivalents) the same
  way `toms/Standard/shineNN` composites over the round body+head. This is
  the missing animation source for square base — today's shipped square
  base/sp presumably already uses this (need bake script to confirm parity
  by diffing against shipped file, see §5 verification step), but square
  **ghost** and square **accent** never had `Shines`/`SqTmAc` baked in.
- No separate `toms square/StarNote` folder — **SP glow for square style
  should reuse the shared `toms/StarNote/NNNN.png` + `sp_cap.png` overlay**,
  the same glow-ring source used for round SP (glow ring is style-neutral;
  only the base shape underneath differs).

### Cymbals / kick

Single style each (`cymbals/Standard`, `cymbals/Accents`,
`cymbals/StarNote`; `drum kicks/` + `drum kicks/sp shine/`) — no
square/round duplication exists or is needed. Out of scope for the bake
except optionally reusing the same "static ghost → animated ghost via
shine overlay" technique for cymbal ghost, called out as a stretch goal in
§6.

## 3. Frame/animation spec

Every `assets2` drum WebP: **128×64 canvas, 16 frames, 50ms/frame
(sequential, no per-frame variation), looping** — confirmed via
`ImageDecoder`/`sharp` metadata on every existing animated file (`pages:
16`), and consistent with `AnimatedTexture` in `TextureManager.ts` which
reads `track.frameCount` and each frame's native duration (falls back to
100ms only on decode failure) and loops via `frameIndex = (frameIndex + 1) %
frameCount`.

Compositing model per output frame `i` (0–15), bottom to top:

1. **Static layers** (same on every frame): body + head (or base + body /
   base-ghost + body-ghost for square), tinted to the drum color.
2. **Animated overlay** (`shine{i}` / `Sh{i}` / `AcPc{i}` / `SqTmAc{i}`,
   varies per frame `i`): drives the only motion in non-SP frames. For
   `accent`, the animated layer (`AcPcNN`/`SqTmAcNN`) *is* the whole frame's
   foreground content (no separate static base+head needed — verified: the
   shipped `-accent.webp` shows the full accent shape changing pose across
   frames, not just a highlight sweeping over a static shape).
3. **SP glow overlay** (`toms/StarNote/{NNNN}.png` glow ring, +
   `sp_cap.png` static highlight): stacked on top of (1)+(2) for `-sp`
   variants, style-neutral (same glow source for square and round).
4. **Ghost dimming**: ghost variants use the dimmer `ghost_tom`/
   `ghost_tom_head` (round) or `SQTMBaseghost`/`SQTMBody-Ghost` (square)
   static layers in place of the normal body/head, and (per §2) gain
   animation by compositing the *normal* (non-ghost) `shine{NN}`/`Sh{NN}`
   sweep on top at reduced opacity — there is no ghost-specific shine
   source, so reusing the normal sweep is the only animation source
   available; the bake script should expose the opacity as a named constant
   (suggest 50%, tune visually) rather than hardcoding it inline.

Tint application: multiply the grayscale RGB by the target drum color
(red/yellow/blue/green — reuse whatever hex values the existing shipped
files were tinted with; extract by sampling a saturated pixel from each
shipped base file, e.g. the `(41,22)` sample above, and treating that as
ground truth for "red", repeating for yellow/blue/green — do not invent new
hex constants).

## 4. Naming + selection design

Add a style axis without breaking the current default look:

- **Square set** (default, matches current visual identity everywhere
  square already renders): keep existing names unchanged —
  `drum-tom-{color}.webp`, `drum-tom-{color}-sp.webp`,
  `drum-tom-{color}-accent.webp`, `drum-tom-{color}-accent-sp.webp`,
  `drum-tom-{color}-ghost.webp`, `drum-tom-{color}-ghost-sp.webp` — but
  regenerate `accent`/`accent-sp`/`ghost`/`ghost-sp` from the square source
  (§2) instead of today's round art, and regenerate `ghost` as 16-frame
  animated instead of 1-frame static.
- **Round set**: new files under a `-round-` infix, inserted after `tom`:
  `drum-tom-round-{color}.webp`, `drum-tom-round-{color}-sp.webp`,
  `drum-tom-round-{color}-accent.webp`,
  `drum-tom-round-{color}-accent-sp.webp`,
  `drum-tom-round-{color}-ghost.webp`, `drum-tom-round-{color}-ghost-sp.webp`.
  (Round accent/accent-sp are then just copies-with-rename of what's
  shipped today as `drum-tom-{color}-accent(-sp).webp`, since that source is
  already round — the bake script should still regenerate them from the
  Unity source rather than copy the shipped file, so both sets come from one
  reproducible pipeline and stay bit-for-bit deterministic.)

`TextureManager.ts` changes (implementation for the follow-up plan, not
this one):

- `loadTomTextures` gains a `style: 'square' | 'round'` parameter, threaded
  through from `loadNoteTextures`. Build the URL as
  `` `${DRUM_TEXTURE_PATH}drum-tom${style === 'round' ? '-round' : ''}-${colorName}${variantSuffix}.webp` ``.
- Cymbals and kick are unaffected (single style) — no parameter needed
  there; `loadCymbalTextures`/`loadKickTextures` keep current signatures.
- For now, thread `style` as a **renderer-level option** only: an optional
  field on whatever config object `loadNoteTextures`'s caller already passes
  in (check current call site — likely `CloneHeroRenderer.tsx` — and add a
  prop there), defaulting to `'square'`. Do **not** build a user-facing UI
  toggle in this pass (explicitly out of scope, §6) — leave a `// TODO:
  surface as a user preference` comment at the prop definition so a future
  plan can wire a settings control without re-deriving where the seam is.

## 5. Bake script design

`scripts/bake-drum-styles.ts` (Node script, run via `pnpm tsx` or similar —
match whatever existing `scripts/` runner convention this repo uses; check
for a prior `scripts/*.ts` bake/generate script and mirror its shebang /
invocation pattern before inventing a new one).

Structure:

- **Pure, Jest-testable helpers** in the script (or extracted to
  `lib/drum-transcription`-adjacent location if reuse seems likely — but
  default to colocating with the script since this is one-off asset tooling,
  not runtime app logic):
  - `tintGrayscale(png: Buffer, colorHex: string): Promise<Buffer>` — multiply
    tint, unit test with a synthetic 2×2 grayscale PNG buffer and assert
    output RGB ratios.
  - `compositeFrames(layers: {source: string | string[]; opacity?: number}[], frameCount: number): Promise<Buffer[]>` —
    for each of 16 frames, flattens the static layers + the frame-indexed
    animated layer (when a layer is given as an array of 16 paths, index by
    frame; when a single path, reuse every frame) via `sharp().composite()`.
    Unit test the frame-selection/opacity logic with tiny fixture PNGs
    (2×2) written to a temp dir in the test, not real 128×64 art — keep
    fixtures small and inline.
  - `framesToAnimatedWebp(frames: Buffer[], delayMs: number, outPath: string): Promise<void>` —
    wraps `sharp` animated WebP encoding (check `sharp`'s
    `join`/`animated`/`delay` API — confirm exact option names against the
    installed `sharp` version's TypeScript types before implementing, don't
    assume based on generic docs).
  - Keep the tint-color table (`{red: '#...', yellow: '#...', ...}`) and the
    per-target-file layer recipe (which source files + opacities compose
    each of the 24 tom outputs) as **exported constants**, unit-testable for
    "every color has all 4 style×variant combinations" completeness without
    needing to run the actual image pipeline.
- **Determinism**: no randomness; `sharp` output should be reproducible
  byte-for-byte across runs on the same machine (verify: run the bake twice,
  diff outputs, note in the plan's completion write-up if `sharp`'s WebP
  encoder isn't perfectly deterministic across runs/platforms — if so, that's
  fine, just don't rely on git diff-emptiness as a correctness check).
- **Verification step built into the script** (or a `--verify` flag): for
  the square set, since `drum-tom-{color}.webp` and
  `drum-tom-{color}-sp.webp` should be visually unchanged (base/sp were
  already square), diff the regenerated frames against the currently
  shipped files pixel-for-pixel (or at least dimension + frame-count +
  perceptual-hash) and warn loudly if they differ — that's a signal the
  layer recipe for square base doesn't actually match what's shipped, before
  overwriting.
- **Output**: script writes directly into
  `public/assets/preview/assets2/`, overwriting the 4 tom `accent`/`ghost`
  files per color (square-corrected) and adding 6 new
  `drum-tom-round-{color}*.webp` files per color. Script is committed;
  generated WebP output is committed too (small, see size estimate below) —
  do not gitignore the output, this mirrors how `assets2` is already
  committed binary art, not generated-on-build.

**Size estimate**: current `assets2/drum-*.webp` total is 2.1MB across 45
files (whole `assets2/` dir is 6.3MB including five-fret). Per-file size for
an animated 128×64/16-frame tom file ranges ~2KB (ghost, mostly-static, e.g.
`drum-tom-red-ghost.webp` = 2278 bytes today) to ~50KB (accent, high detail,
e.g. `drum-tom-red.webp` = 49758 bytes, `drum-tom-red-accent.webp` = 43392
bytes). Net-new files: 4 colors × 6 round-set files = 24 new files, plus 2
regenerated-in-place ghost files per color (was static ~2KB, becomes
16-frame — expect similar order of magnitude to accent-sp, ~10–40KB) growing
in place. Rough estimate: **+800KB to +1.2MB added to the repo**, bringing
`assets2/` to roughly 7–7.5MB. Confirm actual size in the implementation
plan's write-up; if it comes in notably higher, re-check WebP compression
settings (quality/lossless flag) against what the existing shipped files
use (inspect with `identify -verbose` or `sharp` metadata's `isProgressive`/
compression fields, or just match file-size-per-frame-count ballpark).

## 6. Out of scope

- Five-fret note textures (`hopo*`, `strum*`, `tap*`, `open*`) — single
  style, complete, untouched.
- Any user-facing UI to pick square vs round — this plan only adds the
  renderer-level `style` parameter (default `'square'`) and a TODO comment;
  no settings panel, no persistence.
- Cymbal ghost animation and kick — noted as clean/complete in §1; only
  touch them if trivial reuse of the tom technique is obvious, not required
  for this plan to be considered done.
- Red cymbal variants (`accent`/`ghost`/`sp`) — pro-drums has no red
  cymbal; `TextureManager` never requests them; do not generate.
