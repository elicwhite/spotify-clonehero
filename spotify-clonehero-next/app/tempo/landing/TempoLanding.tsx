'use client';

import {type ReactNode} from 'react';
import {
  AudioLines,
  Grid3x3,
  Pencil,
  Waves,
  type LucideIcon,
} from 'lucide-react';

import {ComparisonTable} from '@/components/landing/ComparisonTable';
import {ExternalLink} from '@/components/landing/ExternalLink';
import {LandingHero} from '@/components/landing/LandingHero';
import {LandingPage} from '@/components/landing/LandingPage';
import {ScrollToStartCta} from '@/components/landing/ScrollToStartCta';
import {LandingSection} from '@/components/landing/Section';
import {StepFlow} from '@/components/landing/StepFlow';
import {ToolEntrySection} from '@/components/landing/ToolEntrySection';

import {BeatGridCanvas} from './BeatGridCanvas';
import {TEMPO_COMPARISON_DISCLAIMER, TEMPO_COMPARISON_ROWS} from './metrics';

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
  return (
    <LandingPage>
      <LandingHero
        eyebrow="Tempo mapping"
        title="Build a tempo map from the audio"
        lede={
          <>
            This tool writes a first-pass tempo map from the audio. Some songs
            come out clean, some don&rsquo;t, and you&rsquo;ll see which in
            seconds. Keep the map, tweak it, or throw it away and start from
            scratch.
          </>
        }
        trust={[
          'All processing happens on your computer. Your audio file and chart are never uploaded to a server.',
          'The first run downloads about 515 MB of model files.',
          'Needs WebGPU, so a recent Chrome or Edge.',
        ]}
        illustration={<BeatGridCanvas />}
        caption={
          <>
            Above: a generated tempo map can land off the beat. Drag a beat or
            bar line in the editor to line it up with the notes.
          </>
        }
      />

      <ToolEntrySection
        title="Start a song"
        intro="Pick a song file to get a new chart holding just the tempo map, or an existing chart to rebuild its tempo map without moving its notes in the audio.">
        {toolEntry}
      </ToolEntrySection>

      {/* The centrepiece: the honest account of when this is worth running. */}
      <LandingSection
        title="When it works, and when it doesn't"
        intro="A song that stays in 4/4 usually gets a map you can work with, even when the tempo speeds up, slows down, or drifts. A song that changes meter or sits in odd time should be tempo mapped by hand."
      />

      <LandingSection
        title="How it scores"
        intro="Each generated tempo map was checked against the tempo map in the original chart.">
        <ComparisonTable
          caption="Tempo-map measurements for this tool and ConvertHero on 367 songs."
          rowHeader="Measurement"
          columns={['This tool', 'ConvertHero']}
          groups={[
            {
              rows: TEMPO_COMPARISON_ROWS.map(row => ({
                header: row.measurement,
                cells: [row.ours, row.convertHero],
              })),
            },
          ]}
          footnote={
            <>
              <ExternalLink href="https://github.com/Dirtmigurt/ConvertHero">
                ConvertHero
              </ExternalLink>{' '}
              is an open-source automatic chart tempo-mapping tool.
            </>
          }
          disclaimer={TEMPO_COMPARISON_DISCLAIMER}
        />
      </LandingSection>

      <LandingSection
        title="What it does"
        intro="Three models run on your machine: one separates the drums out of the mix, one finds the beats, one finds where the drum hits land so the map can be pulled onto them. What comes out is a first pass at the tempo map, and the last step is where you take over.">
        <div className="space-y-6">
          <StepFlow steps={STEPS} />
        </div>
      </LandingSection>

      <ScrollToStartCta>Open a song</ScrollToStartCta>
    </LandingPage>
  );
}
