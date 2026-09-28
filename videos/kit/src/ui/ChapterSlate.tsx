import {ease} from '../brand/ease';
import {useLayout} from '../brand/layout';
import {color, space, type} from '../brand/tokens';
import {useGlobalFrame} from '../clock';
import {useFormat} from '../format';
import {alpha, envelope, kf} from '../motion';
import {KineticText} from '../text/KineticText';
import {Eyebrow} from './Eyebrow';
import {
  chapterSlateTiming,
  SLATE_SCRIM_OUT_SEC,
  type SlateTimingProps,
} from './slateTiming';

export interface ChapterSlateProps extends SlateTimingProps {
  /** The chapter's accent colour (eyebrow bar and caret). */
  accent: string;
  /** Top-left of the eyebrow row, px, kept inside the title-safe box (default the slate position from the layout). */
  x?: number;
  y?: number;
  /**
   * Headline font size, px (default the h1 token's, scaled down with the
   * measure where the safe box is narrower than the token's measure, so the
   * headline keeps its line breaks).
   */
  headlineSize?: number;
  /** Headline wrap width, px (default `space.headlineMaxWidth`); never past the safe box. */
  headlineMaxWidth?: number;
  /** Caption wrap width, px (default `space.captionMaxWidth`); never past the safe box. */
  captionMaxWidth?: number;
}

/**
 * A chapter slate: an eyebrow, a headline under it (h1, at most two lines)
 * and an optional caption, all inside the title-safe box. It drifts up a few
 * px over its life, so it is never static. Everything is keyed to film
 * frames, and its timing is `chapterSlateTiming`'s.
 *
 * ```tsx
 * <ChapterSlate accent={lane.yellow} eyebrow="Drum transcription"
 *   headline="Turn a song into a first-pass drum chart"
 *   caption="A trained model listens to the audio and proposes notes."
 *   enterAt={beat(8)} captionAt={beat(9)} exitAt={beat(11, 3)} />
 * ```
 */
export const ChapterSlate: React.FC<ChapterSlateProps> = props => {
  const {
    accent,
    eyebrow,
    caption,
    x,
    y,
    enterAt,
    exitAt,
    eyebrowExitAt = exitAt,
    headlineSize,
    headlineMaxWidth,
    captionMaxWidth,
    scrim = 0,
  } = props;
  const f = useGlobalFrame();
  const {fps, unit} = useFormat();
  const layout = useLayout({x, y});
  const t = chapterSlateTiming(props, fps);
  // Nothing to draw before the bar starts or once every part has left.
  if (f < enterAt || f >= t.gone) return null;

  const {slateX: left, slateY: top, slateWidth: room} = layout;
  const designMeasure = space.headlineMaxWidth * unit;
  const measure =
    headlineMaxWidth === undefined
      ? layout.headlineMaxWidth
      : Math.min(headlineMaxWidth, room);
  const size =
    headlineSize ?? type.h1.size * unit * Math.min(1, measure / designMeasure);
  const lift = kf(f, [
    [enterAt, 4 * unit],
    [exitAt, -4 * unit, ease.drift],
  ]);
  const scrimAmt =
    scrim > 0
      ? scrim *
        envelope(
          f,
          enterAt,
          fps / 3,
          exitAt,
          SLATE_SCRIM_OUT_SEC * fps,
          ease.enter,
          ease.exit,
        )
      : 0;

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        transform: `translateY(${lift}px)`,
      }}>
      {scrimAmt > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: -left,
            top: -top,
            width: measure + left + 400 * unit,
            height: 620 * unit,
            background: `radial-gradient(ellipse 60% 55% at 30% 32%, ${alpha(color.stage, 0.78 * scrimAmt)} 0%, ${alpha(
              color.stage,
              0.45 * scrimAmt,
            )} 45%, ${alpha(color.stage, 0)} 100%)`,
            pointerEvents: 'none',
          }}
        />
      ) : null}
      <Eyebrow
        text={eyebrow}
        accent={accent}
        enterAt={enterAt}
        exitAt={eyebrowExitAt}
        maxWidth={room}
      />
      <KineticText
        {...t.headlineOptions}
        variant="h1"
        size={size}
        maxWidth={measure}
        maxLines={2}
        style={{marginTop: space.slateEyebrowGap * unit}}
      />
      {caption && t.captionOptions ? (
        <KineticText
          {...t.captionOptions}
          variant="caption"
          maxWidth={
            captionMaxWidth === undefined
              ? layout.captionMaxWidth
              : Math.min(captionMaxWidth, room)
          }
          style={{marginTop: space.slateCaptionGap * unit}}
        />
      ) : null}
    </div>
  );
};
