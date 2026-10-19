# Verifying a change is a visual no-op

When you consolidate rather than redesign, the bar is that the page renders
identically. This is the procedure that actually works here, and the two traps
that make the obvious approach lie to you.

## Trap 1: don't diff against a stale baseline

`plans/assets/0099-baseline/` holds screenshots captured by **resizing the
browser window**, where macOS overlay scrollbars leave the layout viewport at
full width. `emulate`'s viewport override instead reserves ~15 CSS px for a
classic scrollbar.

The two differ in layout width, so every centered element lands ~7.5px apart and
the whole page reads as changed. Diffing a fresh capture against those PNGs
will show a large difference that means nothing.

## Trap 2: run the control

The landing pages animate a hero canvas (`EditPassCanvas`, `BeatGridCanvas`). A
nonzero diff there is expected and is **not** evidence of a regression. Without
a control you cannot tell canvas noise from a real change.

## The procedure

1. Copy your changed file aside, restore the pre-change one, and capture at a
   fixed viewport in both schemes:

   ```
   git show HEAD:<path> > <path>
   ```

   Then via chrome-devtools MCP: `emulate` with viewport `1512x960x2` and
   `colorScheme`, then `take_screenshot` with `fullPage: true`.

2. Restore your changed file and capture again at **identical** settings.

3. Diff. `ffmpeg` is available:

   ```bash
   ffmpeg -i old.png -i new.png -lavfi ssim -f null -
   ffmpeg -i old.png -i new.png -filter_complex "blend=all_mode=difference,format=gray" -f rawvideo diff.raw
   ```

   Then find which rows differ, so you know _where_ rather than just _how much_.

4. **Run the control.** Reload the changed page again with no code change and
   diff those two captures. The migration is a no-op when its diff is no larger
   than the control's, in the same region.

Measured example: `/tempo` and `/drum-transcription` both came out the same
size as their pre-migration render and pixel-identical outside the hero-canvas
band, and in both cases the unchanged-code control produced an equal or larger
diff in exactly that band. Without the control, that would have looked like a
regression.

## Cheaper checks that often suffice

Full-page pixel diffing is worth it for a page migration. For smaller changes:

- **Geometry via the DOM.** `evaluate_script` returning `getBoundingClientRect`
  and computed styles for the elements you touched is fast, precise, and
  immune to both traps above. This is how the `SiteMain` gutter change was
  verified: `<main>` computed to zero padding with the page at x=0 spanning the
  full viewport and no horizontal overflow — the same geometry the removed hack
  produced.
- **Rendered class strings.** For a pure composition change, asserting that the
  shell and heading class strings are unchanged proves the rendered output is
  the same without any image work.
- **A margin-collapse check.** Removing an empty wrapper looks like it should
  reclaim space and often does not. Re-insert it via `evaluate_script` and
  compare `scrollHeight`; if the delta is 0, its margin was collapsing and the
  change is a pure DOM cleanup.

## OG cards

Render them; there is no static asset. With `pnpm dev` running:

```bash
curl -s -o /tmp/claude/og.png http://localhost:3000/<route>/opengraph-image
```

Byte-identical file sizes across a refactor are a strong signal it was a true
no-op. A blank or collapsed card is almost always a missing `display: flex`.
