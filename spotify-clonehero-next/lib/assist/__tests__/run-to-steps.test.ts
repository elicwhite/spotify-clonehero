/**
 * run-to-steps.ts tests (plan 0074 Phase 1).
 */

import {
  createStepTimer,
  markStepCompletions,
  stepProgressToSteps,
  type PlannedStep,
} from '../run-to-steps';

const STEPS: PlannedStep[] = [
  {key: 'a', label: 'Step A', description: 'desc a'},
  {key: 'b', label: 'Step B', description: 'desc b'},
  {key: 'c', label: 'Step C', description: 'desc c'},
];

describe('stepProgressToSteps', () => {
  it('renders every step pending when nothing is in flight', () => {
    const timer = createStepTimer();
    const steps = stepProgressToSteps(STEPS, {activeKey: null}, timer);
    expect(steps.map(s => s.status)).toEqual(['pending', 'pending', 'pending']);
  });

  it('renders the active step with its progress and detail, prior steps done, later steps pending', () => {
    const timer = createStepTimer();
    const steps = stepProgressToSteps(
      STEPS,
      {activeKey: 'b', progress: 0.4, detail: 'working'},
      timer,
    );
    expect(steps[0].status).toBe('done');
    expect(steps[1]).toMatchObject({
      status: 'active',
      progress: 0.4,
      detail: 'working',
    });
    expect(steps[2].status).toBe('pending');
  });

  it('renders every non-cached step done on terminal:"done"', () => {
    const timer = createStepTimer();
    const steps = stepProgressToSteps(
      STEPS,
      {activeKey: null, terminal: 'done'},
      timer,
    );
    expect(steps.map(s => s.status)).toEqual(['done', 'done', 'done']);
  });

  it('a cached step always renders done with a "cached" detail, regardless of the active step', () => {
    const cachedSteps: PlannedStep[] = [
      {key: 'a', label: 'Step A', cached: true},
      {key: 'b', label: 'Step B'},
    ];
    const timer = createStepTimer();
    const steps = stepProgressToSteps(
      cachedSteps,
      {activeKey: 'b', progress: 0.1},
      timer,
    );
    expect(steps[0]).toMatchObject({status: 'done', detail: 'cached'});
    expect(steps[1].status).toBe('active');
  });

  it('prefers a source-provided ETA over the elapsed-time fallback', () => {
    const timer = createStepTimer();
    const steps = stepProgressToSteps(
      STEPS,
      {activeKey: 'a', progress: 0.5, etaSeconds: 42},
      timer,
    );
    expect(steps[0].etaSeconds).toBe(42);
  });

  it('gates the fallback ETA below 5% progress', () => {
    const timer = createStepTimer();
    stepProgressToSteps(STEPS, {activeKey: 'a', progress: 0.01}, timer, 1000);
    const steps = stepProgressToSteps(
      STEPS,
      {activeKey: 'a', progress: 0.04},
      timer,
      2000,
    );
    expect(steps[0].etaSeconds).toBeUndefined();
  });

  it('computes and smooths a fallback ETA once progress clears 5%', () => {
    const timer = createStepTimer();
    // Step becomes active at t=0.
    stepProgressToSteps(STEPS, {activeKey: 'a', progress: 0}, timer, 0);
    // At t=1000ms, 10% done: elapsed=1s, raw ETA = 1*(0.9/0.1) = 9s. First
    // sample has no previous smoothed value, so it seeds at the raw value.
    const first = stepProgressToSteps(
      STEPS,
      {activeKey: 'a', progress: 0.1},
      timer,
      1000,
    );
    expect(first[0].etaSeconds).toBeCloseTo(9, 5);

    // At t=2000ms, 50% done: elapsed=2s, raw ETA = 2*(0.5/0.5) = 2s.
    // Smoothed = 9*0.7 + 2*0.3 = 6.9.
    const second = stepProgressToSteps(
      STEPS,
      {activeKey: 'a', progress: 0.5},
      timer,
      2000,
    );
    expect(second[0].etaSeconds).toBeCloseTo(6.9, 5);
  });

  it('records durationMs for a completed step once markStepCompletions ran', () => {
    const timer = createStepTimer();
    stepProgressToSteps(STEPS, {activeKey: 'a', progress: 0.5}, timer, 0);
    markStepCompletions(STEPS, {activeKey: 'b', progress: 0}, timer, 500);
    const steps = stepProgressToSteps(
      STEPS,
      {activeKey: 'b', progress: 0.2},
      timer,
      600,
    );
    expect(steps[0]).toMatchObject({status: 'done', durationMs: 500});
  });

  it('markStepCompletions is a no-op for a cached step (no timer entry needed)', () => {
    const cachedSteps: PlannedStep[] = [
      {key: 'a', label: 'Step A', cached: true},
      {key: 'b', label: 'Step B'},
    ];
    const timer = createStepTimer();
    markStepCompletions(cachedSteps, {activeKey: 'b', progress: 0}, timer, 100);
    expect(timer.has('a')).toBe(false);
  });
});
