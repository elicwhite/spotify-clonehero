import {AbsoluteFill, Audio, Img, useCurrentFrame, useVideoConfig} from 'remotion';
import type {LyricLine} from '@/lib/karaoke/parse-lyrics';
import type {TreatmentId} from './treatments/types';
import {HighlightTreatment} from './treatments/HighlightTreatment';
import {BounceTreatment} from './treatments/BounceTreatment';
import {ScrollTreatment} from './treatments/ScrollTreatment';

export interface KaraokeVideoProps {
  lines: LyricLine[];
  audioUrls: string[];
  albumArtUrl: string | null;
  treatment: TreatmentId;
}

const treatmentComponents = {
  highlight: HighlightTreatment,
  bounce: BounceTreatment,
  scroll: ScrollTreatment,
} as const;

export const KaraokeVideo: React.FC<KaraokeVideoProps> = ({
  lines,
  audioUrls,
  albumArtUrl,
  treatment,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const currentMs = (frame / fps) * 1000;

  const Treatment = treatmentComponents[treatment];

  return (
    <AbsoluteFill className="bg-black">
      {albumArtUrl && (
        <AbsoluteFill className="opacity-30">
          <Img
            src={albumArtUrl}
            className="w-full h-full object-cover blur-2xl"
          />
        </AbsoluteFill>
      )}

      {audioUrls.map((url, i) => (
        <Audio key={i} src={url} />
      ))}

      <Treatment lines={lines} currentMs={currentMs} />
    </AbsoluteFill>
  );
};
