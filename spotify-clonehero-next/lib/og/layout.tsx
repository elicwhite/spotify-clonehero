/**
 * The shared frame for every `opengraph-image.tsx`: background, padding, font
 * stack, brand eyebrow, title, subtitle, and the translucent panel that holds
 * a route's illustration. Route files compose these and contribute only their
 * own illustration and copy; all colors and sizes come from `lib/og/tokens`.
 *
 * Satori renders these, not a browser, so every primitive stays inside the
 * subset the pre-consolidation files already proved works: explicit
 * `display: flex` on every div, no CSS `<style>` blocks (Satori does not
 * apply them — see the Apple Music glyph note in
 * `app/find-music/opengraph-image.tsx`), gradients and inline SVG only.
 */
import type {CSSProperties, ReactNode} from 'react';

import {
  OG_COLORS,
  OG_TYPE,
  type OgSubtitleSize,
  type OgTitleSize,
} from './tokens';

/**
 * The card root: brand background, standard padding, font stack, and a flex
 * column for the content. `center` lays the column out centered both ways,
 * for brand-only cards with no illustration.
 */
export function OgFrame({
  center = false,
  children,
}: {
  center?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        ...(center ? {alignItems: 'center', justifyContent: 'center'} : {}),
        padding: '56px 68px',
        background: OG_COLORS.background,
        color: OG_COLORS.text,
        fontFamily: 'system-ui, sans-serif',
      }}>
      {children}
    </div>
  );
}

/**
 * A wide-tracked label line. Copy is written in literal caps rather than
 * uppercased in CSS, because Satori is the renderer and the string renders as
 * written.
 */
export function OgEyebrow({
  tone = 'muted',
  style,
  children,
}: {
  /** `muted` for the brand line, `accent` for a per-tool label. */
  tone?: 'muted' | 'accent';
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        fontSize: tone === 'accent' ? OG_TYPE.eyebrowTool : OG_TYPE.eyebrow,
        letterSpacing: OG_TYPE.eyebrowTracking,
        color: tone === 'accent' ? OG_COLORS.purple : OG_COLORS.muted,
        ...style,
      }}>
      {children}
    </div>
  );
}

/**
 * The brand line across the top of a card, with an optional right-aligned
 * slot for a per-tool label.
 */
export function OgBrandRow({right}: {right?: ReactNode}) {
  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        alignItems: 'center',
        justifyContent: right ? 'space-between' : 'flex-start',
      }}>
      <OgEyebrow>MUSIC CHARTS TOOLS</OgEyebrow>
      {right ? <OgEyebrow tone="accent">{right}</OgEyebrow> : null}
    </div>
  );
}

/** The card title, at one of the named `OG_TYPE` sizes. */
export function OgTitle({
  size = 'title',
  center = false,
  style,
  children,
}: {
  size?: OgTitleSize;
  center?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        fontSize: OG_TYPE[size],
        fontWeight: OG_TYPE.titleWeight,
        letterSpacing: OG_TYPE.titleTracking,
        lineHeight: 1.05,
        ...(center ? {textAlign: 'center', alignItems: 'center'} : {}),
        ...style,
      }}>
      {children}
    </div>
  );
}

/** The line under the title, at one of the named `OG_TYPE` sizes. */
export function OgSubtitle({
  size = 'subtitle',
  style,
  children,
}: {
  size?: OgSubtitleSize;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        fontSize: OG_TYPE[size],
        color: OG_COLORS.body,
        lineHeight: 1.25,
        ...style,
      }}>
      {children}
    </div>
  );
}

/** The translucent bordered panel a route's illustration sits in. */
export function OgPanel({
  padding = 30,
  style,
  children,
}: {
  padding?: number | string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        padding,
        borderRadius: 24,
        border: `1px solid ${OG_COLORS.panelBorder}`,
        background: OG_COLORS.panel,
        ...style,
      }}>
      {children}
    </div>
  );
}
