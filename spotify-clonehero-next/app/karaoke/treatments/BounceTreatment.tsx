import {useRef} from 'react';
import {AbsoluteFill, interpolate} from 'remotion';
import type {LyricLine, Syllable} from '@/lib/karaoke/parse-lyrics';
import type {TreatmentProps} from './types';

const BALL_SIZE = 20;
const LINE_HEIGHT = 80;
const TRANSITION_MS = 350;
const CONTAINER_HEIGHT = LINE_HEIGHT * 3;

export const BounceTreatment: React.FC<TreatmentProps> = ({
  lines,
  currentMs,
}) => {
  const topLineRef = useRef<HTMLDivElement>(null);
  const syllableRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const outerRef = useRef<HTMLDivElement>(null);

  let currentLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (currentMs >= lines[i].startMs - 500 && currentMs < lines[i].endMs) {
      currentLineIndex = i;
      break;
    }
  }

  let topLine: LyricLine | null = null;
  let bottomLine: LyricLine | null = null;

  if (currentLineIndex >= 0) {
    topLine = lines[currentLineIndex];
    bottomLine = lines[currentLineIndex + 1] ?? null;
  } else {
    const nextIndex = lines.findIndex(l => l.startMs > currentMs);
    if (nextIndex >= 0 && lines[nextIndex].startMs - currentMs < 2000) {
      bottomLine = lines[nextIndex];
    }
  }

  let slideProgress = 0;
  if (topLine && bottomLine) {
    const transitionStart = bottomLine.startMs - TRANSITION_MS;
    if (currentMs >= transitionStart) {
      slideProgress = Math.min(
        1,
        (currentMs - transitionStart) / TRANSITION_MS,
      );
    }
  }

  const slideOffset = slideProgress * LINE_HEIGHT;

  // Compute ball position from syllable refs
  let ballRelX: number | null = null;
  let ballRelY: number | null = null;

  if (topLine && outerRef.current && topLineRef.current) {
    const ball = getBallProgress(topLine.syllables, topLine.endMs, currentMs);
    const outerRect = outerRef.current.getBoundingClientRect();
    const scale = outerRect.width / outerRef.current.offsetWidth || 1;

    if (ball) {
      const currentEl = syllableRefs.current[ball.index];
      const nextEl = syllableRefs.current[ball.index + 1];

      if (currentEl) {
        const currentRect = currentEl.getBoundingClientRect();
        const currentCenter =
          (currentRect.left + currentRect.width / 2 - outerRect.left) / scale;

        let targetCenter: number;
        if (nextEl) {
          const nextRect = nextEl.getBoundingClientRect();
          targetCenter =
            (nextRect.left + nextRect.width / 2 - outerRect.left) / scale;
        } else {
          targetCenter = (currentRect.right - outerRect.left) / scale;
        }

        ballRelX = interpolate(
          ball.progress,
          [0, 1],
          [currentCenter, targetCenter],
        );
        const bounceY = interpolate(
          Math.sin(ball.progress * Math.PI),
          [0, 1],
          [0, -45],
        );
        const lineTop =
          (topLineRef.current.getBoundingClientRect().top - outerRect.top) /
          scale;
        ballRelY = lineTop + bounceY;
      }
    } else if (currentLineIndex >= 0) {
      const lastSyllable = topLine.syllables[topLine.syllables.length - 1];
      const lastSyllableEnd = bottomLine
        ? bottomLine.startMs
        : topLine.endMs;
      if (
        bottomLine &&
        currentMs >= lastSyllable.msTime &&
        currentMs < lastSyllableEnd
      ) {
        const progress = Math.min(
          1,
          (currentMs - lastSyllable.msTime) /
            (lastSyllableEnd - lastSyllable.msTime),
        );
        const lastEl =
          syllableRefs.current[topLine.syllables.length - 1];
        if (lastEl) {
          const lastRect = lastEl.getBoundingClientRect();
          const endX = (lastRect.right - outerRect.left) / scale;
          const centerX = outerRef.current.offsetWidth / 2;
          ballRelX = interpolate(progress, [0, 1], [endX, centerX]);

          const lineTop =
            (topLineRef.current.getBoundingClientRect().top - outerRect.top) /
            scale;
          const arcY = interpolate(
            Math.sin(progress * Math.PI),
            [0, 1],
            [0, -60],
          );
          const dropY = interpolate(progress, [0, 1], [0, LINE_HEIGHT]);
          ballRelY = lineTop + arcY + dropY;
        }
      }
    }
  }

  return (
    <AbsoluteFill className="flex flex-col items-center justify-end pb-24">
      <div
        ref={outerRef}
        style={{
          position: 'relative',
          height: CONTAINER_HEIGHT,
          width: '100%',
        }}>
        {/* Text layer */}
        <div style={{position: 'absolute', inset: 0}}>
          <div
            style={{
              position: 'absolute',
              bottom: LINE_HEIGHT / 2,
              left: 0,
              right: 0,
              transform: `translateY(${-slideOffset}px)`,
            }}>
            {topLine && (
              <div
                ref={topLineRef}
                className="text-center px-16"
                style={{
                  height: LINE_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <span
                  className="text-5xl font-bold leading-tight"
                  style={{
                    textShadow: '0 2px 8px rgba(0,0,0,0.8)',
                    whiteSpace: 'pre-wrap',
                  }}>
                  {topLine.syllables.map((syllable, i) => {
                    const isHighlighted =
                      currentLineIndex >= 0 && currentMs >= syllable.msTime;
                    return (
                      <span
                        key={`${syllable.msTime}-${i}`}
                        ref={el => {
                          syllableRefs.current[i] = el;
                        }}
                        style={{
                          color: isHighlighted
                            ? '#facc15'
                            : 'rgba(255, 255, 255, 0.7)',
                        }}>
                        {syllable.text}
                      </span>
                    );
                  })}
                </span>
              </div>
            )}
            {bottomLine && (
              <div
                className="text-center px-16"
                style={{
                  height: LINE_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0.4,
                }}>
                <span
                  className="text-5xl font-bold leading-tight"
                  style={{
                    textShadow: '0 2px 8px rgba(0,0,0,0.8)',
                    whiteSpace: 'pre-wrap',
                    color: 'rgba(255, 255, 255, 0.7)',
                  }}>
                  {bottomLine.text}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Ball overlay */}
        {ballRelX != null && ballRelY != null && (
          <div
            style={{
              position: 'absolute',
              left: ballRelX - BALL_SIZE / 2,
              top: ballRelY - BALL_SIZE - 8,
              pointerEvents: 'none',
              filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
            }}>
            <svg width={BALL_SIZE} height={BALL_SIZE} viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="10" fill="#facc15" />
              <circle cx="7" cy="7" r="3" fill="rgba(255,255,255,0.4)" />
            </svg>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

function getBallProgress(
  syllables: Syllable[],
  lineEndMs: number,
  currentMs: number,
): {index: number; progress: number} | null {
  for (let i = 0; i < syllables.length; i++) {
    const start = syllables[i].msTime;
    const end =
      i < syllables.length - 1 ? syllables[i + 1].msTime : lineEndMs;
    if (currentMs >= start && currentMs < end) {
      return {index: i, progress: (currentMs - start) / (end - start)};
    }
  }
  return null;
}
