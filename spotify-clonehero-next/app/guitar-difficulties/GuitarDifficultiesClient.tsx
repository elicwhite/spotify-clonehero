'use client';

import {Calculator, ListMusic, Repeat, StretchHorizontal} from 'lucide-react';

import DifficultyGenerationFlow from '@/components/difficulty-generation/DifficultyGenerationFlow';
import {DifficultyLanding} from '@/components/difficulty-generation/landing/DifficultyLanding';
import {useToolLandingView} from '@/components/analytics/useToolLandingView';

/**
 * The /guitar-difficulties page. Copy lives here, at the call site. Model
 * facts stated below: the reducer is the e101baa export
 * (`lib/guitar-difficulty/onnx.ts`, mirrored in
 * `public/models/guitar-reduction-v1/`), running through onnxruntime-web
 * on WebGPU where the browser offers it and on the CPU through WASM
 * otherwise; the "up to 96 measurements" figure is the widest tier's
 * `features_width` in that directory's `manifest.json` (Easy reads 96,
 * Hard and Medium the first 60 of the same ordering).
 */
export default function GuitarDifficultiesClient() {
  useToolLandingView('guitar-difficulties');
  return (
    <DifficultyGenerationFlow
      instrument="guitar"
      dropZoneId="guitar-difficulties-picker"
      landing={toolEntry => (
        <DifficultyLanding
          instrument="guitar"
          eyebrow="Guitar difficulties"
          title={<>Generate guitar Hard, Medium, and Easy from Expert</>}
          lede={
            <>
              This tool automatically adds Hard, Medium, and Easy guitar parts
              from the Expert track.
            </>
          }
          trust={[
            'Runs in your browser. Your chart and audio are never uploaded.',
            'No graphics-card requirement: the model uses your graphics card when the browser offers one, and runs on the CPU when it does not.',
          ]}
          entryIntro="Drop a .sng, .zip, or chart folder that has an Expert guitar track and its audio files. The generated tiers are a first pass: you review them in the chart editor and decide what ships."
          rulesIntro={
            <>
              A trained model predicts what each tier keeps at every moment of
              your Expert track, from up to 96 measurements of the chart around
              that moment. A fixed sequence of steps, the same on every run,
              turns the model&rsquo;s predictions into notes, sustains, and
              markings.
            </>
          }
          ruleRows={[
            {
              name: 'Chord shape',
              desc: 'Which of the five frets are held at this instant.',
            },
            {
              name: 'Neighbor shapes',
              desc: 'The frets held at the note before and the note after.',
            },
            {
              name: 'Note spacing',
              desc: 'How long since the previous note and until the next, in beats.',
            },
            {
              name: 'Bar position',
              desc: 'Where the moment sits in its bar, and the beat it lands on.',
            },
            {
              name: 'Sustain length',
              desc: 'How long each fret’s note is held.',
            },
            {
              name: 'Technique',
              desc: 'Whether each note is a strum, a HOPO, or a tap.',
            },
            {
              name: 'Nearby notes',
              desc: 'How crowded the chart is within half a beat, a beat, two, and four, on either side.',
            },
            {
              name: 'Section membership',
              desc: 'Whether the moment sits inside a Star Power or solo section.',
            },
          ]}
          ruleRowsClose="and the rest"
          decodeSteps={[
            {
              Icon: ListMusic,
              label: 'Predict each moment’s notes',
              desc: 'The model gives probabilities over a fixed menu of shapes the tier can play at that moment: single notes, some two-note chords on Hard and Medium, or nothing. A chord is decided as one whole shape.',
            },
            {
              Icon: Repeat,
              label: 'Judge repeats together',
              desc: 'Short phrases that repeat with the same notes and rhythm are pooled: each repeat’s prediction is blended a quarter of the way toward the group’s average, which pushes repeats toward the same reduction without guaranteeing it. Medium also blends in a fixed table of common phrases.',
            },
            {
              Icon: Calculator,
              label: 'Pick the cheapest shape',
              desc: 'Each moment then takes the shape with the lowest expected number of edits against the prediction, using a fixed cost table that prices added notes, dropped notes, and fret moves.',
            },
            {
              Icon: StretchHorizontal,
              label: 'Write sustains and markings',
              desc: 'Fixed rules place the predicted sustains, strum and HOPO markings, and Star Power and solo ranges, then all four difficulties open in the chart editor.',
            },
          ]}
          rulesAfter={[
            <>
              Sustains follow the same split: the model proposes whether a note
              sustains and for how long, and fixed rules cap the sustain at the
              next note on that fret. Medium and Easy also keep at least a beat
              of space before the next note. Hammer-ons and pull-offs survive
              only on Hard; Medium and Easy are written as all strums, and a
              Hard hammer-on or pull-off that repeats the previous note&rsquo;s
              highest fret is forced to a strum. Taps survive on no tier: a
              tapped Expert note comes back as a strum or a hammer-on.
            </>,
            <>
              Star Power and solo ranges are predicted moment by moment and
              rebuilt on each tier, so a range can start or end at any note.
            </>,
          ]}
          toolEntry={toolEntry}
        />
      )}
    />
  );
}
