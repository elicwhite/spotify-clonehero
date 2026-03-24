import {AbsoluteFill, interpolate} from 'remotion';
import type {LyricLine} from '@/lib/karaoke/parse-lyrics';
import type {TreatmentProps} from './types';

const LINE_HEIGHT = 80;
const TRANSITION_MS = 350;
const CONTAINER_HEIGHT = LINE_HEIGHT * 2 + 40;

export const HighlightTreatment: React.FC<TreatmentProps> = ({
  lines,
  currentMs,
}) => {
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

  return (
    <AbsoluteFill className="flex flex-col items-center justify-end pb-24">
      <div
        style={{
          position: 'relative',
          height: CONTAINER_HEIGHT,
          width: '100%',
        }}>
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            transform: `translateY(${-slideOffset}px)`,
          }}>
          {topLine && (
            <div
              className="text-center px-16"
              style={{
                height: LINE_HEIGHT,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: interpolate(slideProgress, [0.5, 1], [1, 0.4], {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                }),
              }}>
              <SyllableHighlight
                line={topLine}
                currentMs={currentMs}
                isActive={currentLineIndex >= 0}
              />
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
              <SyllableHighlight
                line={bottomLine}
                currentMs={currentMs}
                isActive={false}
              />
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SyllableHighlight: React.FC<{
  line: LyricLine;
  currentMs: number;
  isActive: boolean;
}> = ({line, currentMs, isActive}) => {
  return (
    <span
      className="text-5xl font-bold leading-tight"
      style={{textShadow: '0 2px 8px rgba(0,0,0,0.8)'}}>
      {line.syllables.map((syllable, i) => {
        const isHighlighted = isActive && currentMs >= syllable.msTime;
        const nextSyllableTime =
          i < line.syllables.length - 1
            ? line.syllables[i + 1].msTime
            : line.endMs;
        const progress = isActive
          ? Math.min(
              1,
              Math.max(
                0,
                (currentMs - syllable.msTime) /
                  (nextSyllableTime - syllable.msTime),
              ),
            )
          : 0;

        return (
          <span
            key={`${syllable.msTime}-${i}`}
            style={{
              color: isHighlighted
                ? `rgb(255, ${220 + Math.round(35 * (1 - progress))}, ${80 + Math.round(175 * (1 - progress))})`
                : 'rgba(255, 255, 255, 0.7)',
              transition: 'color 0.05s ease',
            }}>
            {syllable.text}
          </span>
        );
      })}
    </span>
  );
};
