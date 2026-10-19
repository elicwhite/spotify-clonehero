/**
 * Cached `ctx.measureText().width`.
 *
 * The piano-roll painters measure a label for EVERY lyric syllable, time
 * signature and section in the song on every frame, because the measured
 * width is also the hit-test rect and must be published for off-screen items
 * too. Measuring is a text-shaping call, so on a long chart it is one of the
 * most expensive things the frame does.
 *
 * A width is a pure function of the string and the font, so the pair is a
 * complete key. The font is passed in rather than read back off the context:
 * `ctx.font` is a getter that re-serializes the font shorthand, and at a few
 * hundred labels a frame that read cost more than the lookup it keyed. Pass
 * the same literal the caller assigned to `ctx.font`.
 */

/** font → text → width. */
const widths = new Map<string, Map<string, number>>();

/**
 * Entries live for the page's lifetime, so the cache is bounded rather than
 * growing with every edit to a lyric. The limit is far above any real chart's
 * distinct-label count; passing it drops the font's whole bucket, which
 * re-measures once and then settles again.
 */
const MAX_PER_FONT = 4096;

export function measureTextWidth(
  ctx: CanvasRenderingContext2D,
  font: string,
  text: string,
): number {
  let byText = widths.get(font);
  if (byText === undefined) {
    byText = new Map();
    widths.set(font, byText);
  }
  const hit = byText.get(text);
  if (hit !== undefined) return hit;
  const width = ctx.measureText(text).width;
  if (byText.size >= MAX_PER_FONT) byText.clear();
  byText.set(text, width);
  return width;
}
