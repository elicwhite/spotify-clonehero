'use client';

import {useCallback, type ReactNode} from 'react';
import {
  AudioLines,
  Grid3x3,
  Pencil,
  Waves,
  type LucideIcon,
} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {TooltipProvider} from '@/components/ui/tooltip';
import {Eyebrow} from '@/components/landing/Eyebrow';
import {LandingSection} from '@/components/landing/Section';
import {StepFlow} from '@/components/landing/StepFlow';
import {TrustLine} from '@/components/landing/TrustLine';

import {BeatGridCanvas} from './BeatGridCanvas';

const STEPS: {Icon: LucideIcon; label: string; desc: string}[] = [
  {
    Icon: Waves,
    label: 'Separate the drums',
    desc: 'BS-Roformer, a separation model, isolates the drum stem from the full mix.',
  },
  {
    Icon: Grid3x3,
    label: 'Find the beats',
    desc: 'Beat This!, a beat-tracking model, listens to the full mix and to the drum stem and marks where the beats and the bar starts are.',
  },
  {
    Icon: AudioLines,
    label: 'Fit the tempo map',
    desc: 'A postprocessing step tuned for charts converts the grid into a tempo map.',
  },
  {
    Icon: Pencil,
    label: 'Check it against the audio',
    desc: 'The map opens on a timeline over the waveform. You play it back, move markers or bar lines, and export a .zip or .sng.',
  },
];

/**
 * The /tempo landing page: the entry point to the tool and the page that
 * explains it. The working entry screen is passed in as `toolEntry` so the
 * pipeline flow stays owned by TempoClient.
 */
export function TempoLanding({toolEntry}: {toolEntry: ReactNode}) {
  const scrollToStart = useCallback(() => {
    document
      .getElementById('start')
      ?.scrollIntoView({behavior: 'smooth', block: 'start'});
  }, []);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="landing-lanes w-full max-w-4xl space-y-12 py-8 sm:py-12">
        {/* Hero */}
        <header className="space-y-6">
          <Eyebrow>Tempo mapping</Eyebrow>
          <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl [text-wrap:balance]">
            Build a tempo map from the audio
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            This tool writes a first-pass tempo map from the audio. Some songs
            come out clean, some don&rsquo;t, and you&rsquo;ll see which in
            seconds. Keep the map, tweak it, or throw it away and start from
            scratch.
          </p>
          <TrustLine
            items={[
              'All processing happens on your computer. Your audio file and chart are never uploaded to a server.',
              'The first run downloads about 515 MB of model files.',
              'Needs WebGPU, so a recent Chrome or Edge.',
            ]}
          />
          <BeatGridCanvas />
          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
            Above: a generated tempo map can land off the beat. Drag a beat or
            bar line in the editor to line it up with the notes.
          </p>
        </header>

        {/* Tool entry: the working screen, promoted to the top of the page. */}
        <LandingSection
          id="start"
          title="Start a song"
          intro="Pick a song file to get a new chart holding just the tempo map, or an existing chart to rebuild its tempo map without moving its notes in the audio.">
          <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6">
            {toolEntry}
          </div>
        </LandingSection>

        {/* The centrepiece: the honest account of when this is worth running. */}
        <LandingSection
          title="When it works, and when it doesn't"
          intro="A song that stays in 4/4 usually gets a map you can work with, even when the tempo speeds up, slows down, or drifts. A song that changes meter or sits in odd time should be tempo mapped by hand.">
          {null}
        </LandingSection>

        <LandingSection
          title="What it does"
          intro="Three models run on your machine: one separates the drums out of the mix, one finds the beats, one finds where the drum hits land so the map can be pulled onto them. What comes out is a first pass at the tempo map, and the last step is where you take over.">
          <div className="space-y-6">
            <StepFlow steps={STEPS} />
          </div>
        </LandingSection>

        <div className="flex flex-col items-start border-t border-border pt-8">
          <Button onClick={scrollToStart}>Open a song</Button>
        </div>
      </div>
    </TooltipProvider>
  );
}
