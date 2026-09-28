import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {useFilterId} from './filterId';

export interface ChromaSplitProps {
  /** Channel offset in px (red one way, blue the other). Near 0 the children render untouched. */
  amount: number;
  /** Split direction in degrees (0 = horizontal). */
  angle?: number;
  /** Fill the frame (default) or wrap inline content. */
  fill?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * Chromatic aberration: the red channel shifts one way, blue the other, green
 * stays. An SVG filter over the children, applied ONLY while `amount` is
 * visible (above 0.05 px), because a full-frame filter is one of the most
 * expensive effects in the kit. Drive `amount` from a pulse.
 */
export const ChromaSplit: React.FC<ChromaSplitProps> = ({
  amount,
  angle = 0,
  fill = true,
  style,
  children,
}) => {
  const id = useFilterId('chroma');
  const Wrapper = fill ? AbsoluteFill : 'div';
  if (Math.abs(amount) < 0.05)
    return <Wrapper style={style}>{children}</Wrapper>;
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad) * amount;
  const dy = Math.sin(rad) * amount;
  return (
    <Wrapper style={{...style, filter: `url(#${id})`}}>
      <svg width={0} height={0} style={{position: 'absolute'}} aria-hidden>
        <defs>
          <filter
            id={id}
            x="-2%"
            y="-2%"
            width="104%"
            height="104%"
            colorInterpolationFilters="sRGB">
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="r"
            />
            <feOffset in="r" dx={-dx} dy={-dy} result="ro" />
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="g"
            />
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
              result="b"
            />
            <feOffset in="b" dx={dx} dy={dy} result="bo" />
            <feBlend in="ro" in2="g" mode="screen" result="rg" />
            <feBlend in="rg" in2="bo" mode="screen" />
          </filter>
        </defs>
      </svg>
      {children}
    </Wrapper>
  );
};
