'use client';

import {ArrowRightLeft, CopyCheck, Filter, Repeat} from 'lucide-react';

import DifficultyGenerationFlow from '@/components/difficulty-generation/DifficultyGenerationFlow';
import {DifficultyLanding} from '@/components/difficulty-generation/landing/DifficultyLanding';
import {useToolLandingView} from '@/components/analytics/useToolLandingView';

/**
 * The /drum-difficulties page. Copy lives here, at the call site. Model
 * facts stated below: the reducer is packed decision-tree ensembles
 * (`lib/drum-difficulty/ours/model.ts`, in
 * `public/models/drum-difficulty/v5/`), deliberately deterministic across
 * browsers (`lib/drum-difficulty/ours/portableExp.ts`); the decode gaps
 * (180 ms / 250 ms) and the 59-feature count come from that model
 * directory's `manifest.json` and `feature_names_v5.json`.
 */
export default function DrumDifficultiesClient() {
  useToolLandingView('drum-difficulties');
  return (
    <DifficultyGenerationFlow
      instrument="drums"
      dropZoneId="drum-difficulties-picker"
      landing={toolEntry => (
        <DifficultyLanding
          instrument="drums"
          eyebrow="Drum difficulties"
          title={<>Generate drum Hard, Medium, and Easy from Expert</>}
          lede={
            <>
              This tool automatically adds Hard, Medium, and Easy drum parts
              from the Expert track.
            </>
          }
          trust={[
            'Runs in your browser. Your chart and audio are never uploaded.',
            'Deterministic: the same chart produces the same three tiers every time, in any browser.',
          ]}
          entryIntro="Drop a .sng, .zip, or chart folder that has an Expert drums track and its audio files. The generated tiers are a first pass: you review them in the chart editor and decide what ships."
          rulesIntro={
            <>
              A trained model scores every note of your Expert track once per
              tier, from 59 numbers that describe the note and the chart around
              it. A fixed sequence of steps then turns those scores into the
              tier&rsquo;s notes. The steps are arithmetic you could check by
              hand, and the same chart produces the same three tiers every time.
            </>
          }
          ruleRows={[
            {
              name: 'Chord size',
              desc: 'How many notes are hit at the same instant, counting this one.',
            },
            {
              name: 'Beat in the measure',
              desc: 'Where the note sits between one downbeat and the next.',
            },
            {
              name: 'Grid alignment',
              desc: 'Whether the note lands on the eighth-note grid.',
            },
            {
              name: 'Nearby hits',
              desc: 'How many other hits land within a quarter second on either side, with a chord counted once.',
            },
            {
              name: 'Distance to the backbone',
              desc: 'How far the note is from the nearest kick or snare.',
            },
            {
              name: 'Same-drum gap',
              desc: 'How long the note’s own drum has been quiet before it.',
            },
            {
              name: 'Ghost marking',
              desc: 'Whether the hit is charted as a ghost note.',
            },
            {
              name: 'Section type',
              desc: 'Whether the note falls in a verse, a chorus, a solo, or a fill.',
            },
          ]}
          ruleRowsClose="and the rest"
          decodeSteps={[
            {
              Icon: Repeat,
              label: 'Judge repeats together',
              desc: 'Measures whose Expert groove is identical are grouped first. A note’s score is averaged with the same note in every repeat, so a verse groove is judged once, as a pattern.',
            },
            {
              Icon: Filter,
              label: 'Keep or drop',
              desc: 'A note survives when its score clears the tier’s fixed bar. Medium and Easy then thin surviving cymbal and tom hits that land closer than 180 ms and 250 ms to a stronger kept hit.',
            },
            {
              Icon: ArrowRightLeft,
              label: 'Move to the tier’s lanes',
              desc: 'A second trained model proposes the lane each surviving cymbal or tom lands on in the simpler tier. Kick and snare never move.',
            },
            {
              Icon: CopyCheck,
              label: 'Make repeats match',
              desc: 'A note’s lane is then put to a group vote: every repeat of the groove weighs in, weighted by the model’s confidence, and all the repeats take the winning lane. On Hard the vote also runs on repeated patterns shorter than a measure. Notes that end up doubled on one lane are merged.',
            },
          ]}
          toolEntry={toolEntry}
        />
      )}
    />
  );
}
