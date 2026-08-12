/**
 * The one place a brand color, gradient, or type size is written down for
 * social cards. Every `opengraph-image.tsx` composes `lib/og/layout.tsx`
 * primitives, which read these tokens; route files contribute only their own
 * illustration and copy. Decisions recorded in `docs/design-system-audit.md`
 * (Track A).
 */

/** Every route's OG image is this size; routes re-export it as `size`. */
export const OG_SIZE = {width: 1200, height: 630} as const;

/**
 * The five Clone Hero drum-lane gem colors, dark theme. OG cards are always
 * dark, so these are the `.landing-lanes` dark values from `app/globals.css`
 * (named in `components/landing/lanes.ts`). Restated here because Satori
 * renders outside the DOM and cannot read CSS custom properties; a Jest test
 * keeps this copy equal to `LANE_FALLBACKS`.
 */
export const OG_LANES = {
  kick: '#ff9a3d',
  red: '#e5484d',
  yellow: '#f5c531',
  blue: '#4c8dff',
  green: '#46c46b',
} as const;

export const OG_COLORS = {
  /** The brand background: a purple radial glow over a near-black sweep. */
  background:
    'radial-gradient(circle at 84% 18%, rgba(168,85,183,0.2), transparent 34%), linear-gradient(135deg, #17091d 0%, #0a0710 58%, #08070d 100%)',
  text: '#ffffff',
  muted: 'rgba(255,255,255,0.64)',
  subtle: 'rgba(255,255,255,0.52)',
  body: 'rgba(255,255,255,0.62)',
  panel: 'rgba(255,255,255,0.055)',
  panelBorder: 'rgba(255,255,255,0.14)',
  card: '#12161f',
  cardBorder: '#242c3a',
  purple: '#a855b7',
  /** Spotify brand green as the app renders it (SetupCard accent). */
  spotify: '#1ed760',
  spotifyInk: '#08210f',
} as const;

/**
 * The OG type scale. A route picks a named title size; there are no per-file
 * font sizes. Weight and tracking are uniform across every card.
 *
 * - `display`: a brand-only card with no illustration (the root default).
 * - `title`: the standard tool card (title + subtitle + illustration).
 * - `titleCompact`: two-line titles, or cards whose illustration needs the
 *   vertical room (find-music's source cards, the chart viewer's album art).
 * - `titleInset`: a title sharing the card with a full-width framed panel
 *   (the drum-transcription / tempo cards).
 */
export const OG_TYPE = {
  display: 132,
  title: 92,
  titleCompact: 66,
  titleInset: 56,
  /**
   * The line under the title. `subtitleLarge` pairs with `display`;
   * `subtitleLead` is the first of two stacked metadata lines, where the
   * second uses plain `subtitle` (the chart viewer's artist over charter).
   */
  subtitle: 32,
  subtitleLead: 46,
  subtitleLarge: 48,
  titleWeight: 760,
  titleTracking: '-0.03em',
  /** The brand line. `eyebrowTool` is the per-tool label beside it. */
  eyebrow: 24,
  eyebrowTool: 20,
  eyebrowTracking: '0.18em',
} as const;

export type OgTitleSize = 'display' | 'title' | 'titleCompact' | 'titleInset';
export type OgSubtitleSize = 'subtitle' | 'subtitleLead' | 'subtitleLarge';
