/**
 * Pieces the visual blocks share: a label naming the block, and an abstract
 * app-like plane for the camera and plane blocks (panels and bars, not a
 * copy of any product screen).
 */
import type {CSSProperties, ReactNode} from 'react';
import {color, fontFamily} from '@musiccharts/video-kit/brand';
import {useFormat} from '@musiccharts/video-kit/format';
import {alpha, rand} from '@musiccharts/video-kit/motion';
import {crispText} from '@musiccharts/video-kit/text';

/** A block's props: its `hero` frame, read by the kit's stills tool (the block ignores it). */
export interface VisualBlockProps {
  hero?: number;
}

/** The block's name, top left, in mono. */
export const BlockLabel: React.FC<{text: string}> = ({text}) => {
  const {unit} = useFormat();
  return (
    <div
      style={{
        ...crispText,
        position: 'absolute',
        left: 40 * unit,
        top: 32 * unit,
        fontFamily: fontFamily.mono,
        fontSize: 20 * unit,
        letterSpacing: '0.08em',
        color: 'rgba(255,255,255,0.55)',
        zIndex: 10,
      }}>
      {text}
    </div>
  );
};

/** A row of children, centred in the frame. */
export const Row: React.FC<{
  children: ReactNode;
  gap?: number;
  style?: CSSProperties;
}> = ({children, gap = 60, style}) => {
  const {unit} = useFormat();
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: gap * unit,
        ...style,
      }}>
      {children}
    </div>
  );
};

/** The size of `DemoPlane`, plane px. */
export const DEMO_PLANE = {width: 1440, height: 900} as const;

/** Plane-px boxes of the demo plane's parts, for rings, callouts and cursor paths. */
export const DEMO_BOXES = {
  button: {x: 1180, y: 110, width: 200, height: 48},
  sidebarItem: {x: 36, y: 250, width: 248, height: 44},
  row: (i: number) => ({x: 336, y: 250 + i * 64, width: 1068, height: 52}),
} as const;

/**
 * An abstract app-like plane: a header, a sidebar, a highlighted button and
 * rows of bars. Plane px, `DEMO_PLANE` in size.
 */
export const DemoPlane: React.FC = () => {
  const bar = (w: number, c: string, o = 1): CSSProperties => ({
    width: w,
    height: 14,
    borderRadius: 7,
    background: alpha(c, o),
  });
  return (
    <div
      style={{
        position: 'relative',
        flex: 'none',
        width: DEMO_PLANE.width,
        height: DEMO_PLANE.height,
        borderRadius: 18,
        background: color.pageBg,
        border: `1px solid ${color.panelBorder}`,
        overflow: 'hidden',
      }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: 84,
          borderBottom: `1px solid ${color.panelBorder}`,
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          padding: '0 36px',
        }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 9,
            background: color.brand,
          }}
        />
        <div style={bar(220, color.white, 0.7)} />
        <div style={bar(90, color.white, 0.3)} />
        <div style={bar(90, color.white, 0.3)} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: DEMO_BOXES.button.x,
          top: DEMO_BOXES.button.y,
          width: DEMO_BOXES.button.width,
          height: DEMO_BOXES.button.height,
          borderRadius: 10,
          background: color.brand,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <div style={bar(110, color.white, 0.9)} />
      </div>
      {Array.from({length: 7}, (_, i) => (
        <div
          key={`s${i}`}
          style={{
            position: 'absolute',
            left: 36,
            top: 250 + i * 64,
            width: 248,
            height: 44,
            borderRadius: 10,
            background: i === 0 ? alpha(color.white, 0.08) : undefined,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '0 16px',
          }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 5,
              background: alpha(color.white, 0.35),
            }}
          />
          <div style={bar(90 + rand('side', i) * 90, color.white, 0.4)} />
        </div>
      ))}
      {Array.from({length: 9}, (_, i) => {
        const r = DEMO_BOXES.row(i);
        return (
          <div
            key={`r${i}`}
            style={{
              position: 'absolute',
              left: r.x,
              top: r.y,
              width: r.width,
              height: r.height,
              borderRadius: 10,
              background: alpha(color.white, i % 2 ? 0.03 : 0.055),
              display: 'flex',
              alignItems: 'center',
              gap: 28,
              padding: '0 22px',
            }}>
            <div style={bar(260 + rand('row', i) * 160, color.white, 0.62)} />
            <div style={bar(160 + rand('row2', i) * 120, color.white, 0.3)} />
            <div
              style={{
                ...bar(120 * (0.3 + rand('score', i) * 0.7), color.purple, 0.9),
                marginLeft: 'auto',
              }}
            />
          </div>
        );
      })}
    </div>
  );
};
