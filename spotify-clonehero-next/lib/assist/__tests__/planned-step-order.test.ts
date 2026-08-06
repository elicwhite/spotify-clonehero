/**
 * Planned-step order vs. real emission order (plan 0074).
 *
 * `run-to-steps.ts` derives every step's status from `index vs currentIndex`
 * with no monotonic clamp, so a planned list ordered differently from the
 * order its source actually emits stages in makes the rendered list run
 * backwards: a step shows "done" before it ran, then reverts to pending when
 * it finally does. That is invisible to a unit test of either half alone, so
 * each task's planned list is pinned here against the emission sequence read
 * out of its source.
 *
 * The emission sequences below are transcribed from the sources named beside
 * them. If a source's stage order changes, this suite is where the planned
 * list has to be changed with it.
 */

import {
  createStepTimer,
  markStepCompletions,
  stepProgressToSteps,
  type PlannedStep,
} from '../run-to-steps';
import {
  AUDIO_TRANSCRIBE_PLANNED_STEPS,
  PIPELINE_PLANNED_STEPS,
} from '@/lib/drum-transcription/pipeline/step-mapping';

jest.mock('../../audio-pipeline/stem-cache', () => ({
  ...jest.requireActual('../../audio-pipeline/stem-cache'),
  hasStem: jest.fn(),
  hasStemOpus: jest.fn(),
}));

import {hasStem, hasStemOpus} from '@/lib/audio-pipeline/stem-cache';
import {makeGenerateTempoMapTask} from '../tasks/generate-tempo-map';
import {makeGenerateSectionsTask} from '../tasks/generate-sections';
import {makeAddLyricsTask} from '../tasks/add-lyrics';
import {makeGenerateDifficultiesTask} from '../tasks/generate-difficulties';

const mockHasStem = hasStem as jest.Mock;
const mockHasStemOpus = hasStemOpus as jest.Mock;

/**
 * Replays a source's real stage emission order through the planned list and
 * asserts the two agree: every emitted key is on the list, no step ever
 * regresses out of `done`, and no step reads `done` before it was ever
 * active. A planned list ordered against the wrong sequence fails the last
 * two.
 */
function expectOrderMatchesEmissions(
  planned: readonly PlannedStep[],
  emissions: readonly string[],
): void {
  const plannedKeys = planned.map(s => s.key);
  for (const key of emissions) {
    expect(plannedKeys).toContain(key);
  }

  const timer = createStepTimer();
  const wasActive = new Set<string>();
  const wasDone = new Set<string>();

  for (const activeKey of emissions) {
    const event = {activeKey};
    markStepCompletions(planned, event, timer);
    for (const step of stepProgressToSteps(planned, event, timer)) {
      const cached = planned.find(p => p.key === step.key)?.cached ?? false;
      if (step.status === 'done') {
        // A non-cached step can only be done if the source already ran it.
        if (!cached) expect(wasActive).toContain(step.key);
        wasDone.add(step.key);
      } else {
        // A step that already read done must never fall back.
        expect(wasDone.has(step.key)).toBe(false);
      }
      if (step.status === 'active') wasActive.add(step.key);
    }
  }
}

describe('the order check itself', () => {
  it('fails a planned list ordered against the wrong emission sequence', () => {
    const misordered: PlannedStep[] = [
      {key: 'a', label: 'A'},
      {key: 'c', label: 'C'},
      {key: 'b', label: 'B'},
    ];
    // Replaying a -> b -> c against it renders 'c' done before it ran, then
    // regressed back to pending — exactly the defect this suite exists for.
    expect(() =>
      expectOrderMatchesEmissions(misordered, ['a', 'b', 'c']),
    ).toThrow();
  });
});

const AUDIO = {
  loadOriginalBytes: async () => new Uint8Array(4),
  stemFingerprint: 'fp',
};

describe('generate-tempo-map planned order', () => {
  beforeEach(() => mockHasStem.mockReset());

  /**
   * `lib/tempo-map/pipeline-worker.ts` (`run`), then the CRNN stage
   * `lib/drum-transcription/pipeline/tempo-track.ts` layers on after the
   * worker resolves.
   */
  const COLD_EMISSIONS = [
    'download-separation-model',
    'separate',
    'download-beat-model',
    'beats-fullmix',
    'beats-drums',
    'convert',
    'transcribe-drums',
  ];

  it('matches the tempo worker + CRNN emission order on a cold run', async () => {
    mockHasStem.mockResolvedValue(false);
    const steps = await makeGenerateTempoMapTask().planSteps({audio: AUDIO});
    expect(steps.map(s => s.key)).toEqual(COLD_EMISSIONS);
    expectOrderMatchesEmissions(steps, COLD_EMISSIONS);
  });

  it('matches the emission order on a cached-stem run (separation skipped)', async () => {
    mockHasStem.mockResolvedValue(true);
    const steps = await makeGenerateTempoMapTask().planSteps({audio: AUDIO});
    expect(
      steps
        .filter(s => s.cached)
        .map(s => s.key)
        .sort(),
    ).toEqual(['download-separation-model', 'separate']);
    // The cache-hit worker still emits `separate` (with a "reused" detail)
    // before loading the beat model; the model download never happens.
    expectOrderMatchesEmissions(steps, [
      'separate',
      'download-beat-model',
      'beats-fullmix',
      'beats-drums',
      'convert',
      'transcribe-drums',
    ]);
  });

  // Plan 0076 item 24: the KS-warp stage does real tempo work (it aligns the
  // grid to detected drum onsets) and takes long enough that hiding it would
  // misrepresent the run — so it stays, presented as tempo work rather than
  // as "listening to drum hits", which read like transcription.
  it('presents the KS-warp stage as tempo work, with a reason', async () => {
    mockHasStem.mockResolvedValue(false);
    const steps = await makeGenerateTempoMapTask().planSteps({audio: AUDIO});
    const step = steps.find(s => s.key === 'transcribe-drums');
    expect(step?.label).toBe('Aligning grid to drum hits');
    expect(step?.description).toBeTruthy();
  });

  // Plan 0076 item 23: section labeling is its own task now, so a tempo run
  // neither plans nor emits a 'sections' stage.
  it('plans no section-labeling stage', async () => {
    mockHasStem.mockResolvedValue(false);
    const steps = await makeGenerateTempoMapTask().planSteps({audio: AUDIO});
    expect(steps.map(s => s.key)).not.toContain('sections');
  });
});

describe('generate-sections planned order', () => {
  // `lib/tempo-map/pipeline-worker.ts` (`runSections`): no separation, no
  // drum-stem beat pass, no converter.
  it('matches the sections-only emission order', async () => {
    const steps = await makeGenerateSectionsTask().planSteps({audio: AUDIO});
    expectOrderMatchesEmissions(steps, [
      'download-beat-model',
      'beats-fullmix',
      'sections',
    ]);
  });
});

describe('transcribe-drums planned order', () => {
  // `lib/drum-transcription/pipeline/runner.ts` (runPipeline), preceded by
  // the task's own `waitForOrtRuntime` 'loading-runtime' tick.
  it('matches runPipeline for a fresh upload', () => {
    expectOrderMatchesEmissions(PIPELINE_PLANNED_STEPS, [
      'loading-runtime',
      'decoding',
      'separating',
      'tempo-mapping',
      'transcribing',
    ]);
  });

  // `runPipelineFromChart`: the chart supplies the grid, so no tempo-mapping.
  it('matches runPipelineFromChart with tempo-mapping cached', () => {
    const planned = PIPELINE_PLANNED_STEPS.map(s => ({
      ...s,
      cached: s.key === 'tempo-mapping',
    }));
    expectOrderMatchesEmissions(planned, [
      'loading-runtime',
      'decoding',
      'separating',
      'transcribing',
    ]);
  });

  // `lib/assist/tasks/transcribe-drums-from-audio.ts`: the in-editor re-run
  // works off the chart's own grid, so no tempo-mapping stage exists to
  // show, cached or otherwise.
  it('matches the in-editor re-run, with and without a cached stem', () => {
    expectOrderMatchesEmissions(AUDIO_TRANSCRIBE_PLANNED_STEPS, [
      'loading-runtime',
      'separating',
      'transcribing',
    ]);
    const cachedStem = AUDIO_TRANSCRIBE_PLANNED_STEPS.map(s => ({
      ...s,
      cached: s.key === 'separating',
    }));
    expectOrderMatchesEmissions(cachedStem, [
      'loading-runtime',
      'transcribing',
    ]);
  });
});

describe('add-lyrics planned order', () => {
  beforeEach(() => mockHasStemOpus.mockReset());

  const task = makeAddLyricsTask();
  const STEM = {data: new Uint8Array(2), mimeType: 'audio/ogg'};

  // Emission order is `run`'s own, in lib/assist/tasks/add-lyrics.ts.
  it('matches the bundled-stem branch (separation skipped)', async () => {
    const steps = await task.planSteps({
      lyrics: 'la',
      vocals: {kind: 'bundled', stem: STEM},
    });
    expect(steps.find(s => s.key === 'separate')?.cached).toBe(true);
    expectOrderMatchesEmissions(steps, ['load', 'syllabify', 'align']);
  });

  it('matches the forced-restems branch', async () => {
    const steps = await task.planSteps({
      lyrics: 'la',
      vocals: {kind: 'stems', stems: [STEM]},
    });
    expectOrderMatchesEmissions(steps, [
      'separate',
      'load',
      'syllabify',
      'align',
    ]);
  });

  it('matches the resolve branch on a cache miss (Demucs runs)', async () => {
    mockHasStemOpus.mockResolvedValue(false);
    const steps = await task.planSteps({
      lyrics: 'la',
      vocals: {kind: 'resolve', audio: AUDIO},
    });
    expect(steps.find(s => s.key === 'separate')?.cached).toBe(false);
    expectOrderMatchesEmissions(steps, [
      'separate',
      'load',
      'syllabify',
      'align',
    ]);
  });

  it('matches the resolve branch on a cache hit (separation skipped)', async () => {
    mockHasStemOpus.mockResolvedValue(true);
    const steps = await task.planSteps({
      lyrics: 'la',
      vocals: {kind: 'resolve', audio: AUDIO},
    });
    expect(steps.find(s => s.key === 'separate')?.cached).toBe(true);
    expectOrderMatchesEmissions(steps, ['load', 'syllabify', 'align']);
  });
});

describe('generate-difficulties planned order', () => {
  it('matches its single reduce stage', async () => {
    const steps = await makeGenerateDifficultiesTask().planSteps(
      undefined as never,
    );
    expectOrderMatchesEmissions(steps, ['reduce']);
  });
});
