import {AbsoluteFill, interpolate} from 'remotion';
import type {TreatmentProps} from './types';

const LINE_HEIGHT = 72;

export const ScrollTreatment: React.FC<TreatmentProps> = ({
  lines,
  currentMs,
}) => {
  let currentLineIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    if (currentMs >= lines[i].phraseStartMs) {
      currentLineIndex = i;
    }
  }

  const currentLine = lines[currentLineIndex];
  const nextLine = lines[currentLineIndex + 1];
  let scrollProgress = 0;
  if (nextLine) {
    scrollProgress = interpolate(
      currentMs,
      [currentLine.phraseStartMs, nextLine.phraseStartMs],
      [0, 1],
      {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
    );
  }

  const scrollOffset = (currentLineIndex + scrollProgress) * LINE_HEIGHT;

  return (
    <AbsoluteFill className="overflow-hidden">
      {/* Fade gradients */}
      <div
        className="absolute inset-x-0 top-0 z-10"
        style={{
          height: '25%',
          background:
            'linear-gradient(to bottom, rgba(0,0,0,1) 0%, transparent 100%)',
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 z-10"
        style={{
          height: '25%',
          background:
            'linear-gradient(to top, rgba(0,0,0,1) 0%, transparent 100%)',
        }}
      />

      <div className="absolute inset-0 w-full text-center">
        <div
          style={{
            transform: `perspective(100px) translateY(calc(50vh - ${LINE_HEIGHT / 2}px - ${scrollOffset}px))`,
            willChange: 'transform',
          }}>
          {lines.map((line, i) => {
            const isCurrent = i === currentLineIndex;
            const distance = Math.abs(i - currentLineIndex - scrollProgress);
            const opacity = interpolate(distance, [0, 3, 5], [1, 0.4, 0.15], {
              extrapolateRight: 'clamp',
            });

            return (
              <div
                key={`${line.phraseStartMs}-${i}`}
                className="px-16"
                style={{
                  height: LINE_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity,
                }}>
                <span
                  className="text-4xl font-bold leading-tight"
                  style={{textShadow: '0 2px 8px rgba(0,0,0,0.8)'}}>
                  {line.syllables.map((syllable, si) => {
                    const isHighlighted =
                      isCurrent && currentMs >= syllable.msTime;
                    const nextSyllableTime =
                      si < line.syllables.length - 1
                        ? line.syllables[si + 1].msTime
                        : line.phraseEndMs;
                    const progress = isCurrent
                      ? Math.min(
                          1,
                          Math.max(
                            0,
                            (currentMs - syllable.msTime) /
                              (nextSyllableTime - syllable.msTime),
                          ),
                        )
                      : 0;

                    const pastLine = i < currentLineIndex;

                    return (
                      <span
                        key={`${syllable.msTime}-${si}`}
                        style={{
                          color:
                            pastLine || isHighlighted
                              ? `rgb(255, ${220 + Math.round(35 * (1 - progress))}, ${80 + Math.round(175 * (1 - progress))})`
                              : 'rgba(255, 255, 255, 0.7)',
                        }}>
                        {syllable.text}
                      </span>
                    );
                  })}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
