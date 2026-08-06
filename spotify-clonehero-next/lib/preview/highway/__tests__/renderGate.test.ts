import {RenderGate, DEFAULT_LINGER_MS, TIME_EPSILON_MS} from '../renderGate';

/** A paused, unchanged frame at a fixed chart time. */
function idle(nowMs: number, elapsedMs = 1000) {
  return {nowMs, elapsedMs, isPlaying: false};
}

describe('RenderGate', () => {
  it('draws the first frame it is ever asked about', () => {
    const gate = new RenderGate();
    const decision = gate.evaluate(idle(0));
    expect(decision).toEqual({render: true, reason: 'first', keepAwake: true});
  });

  it('skips a repeat of the frame it just drew', () => {
    const gate = new RenderGate();
    gate.evaluate(idle(0));
    const decision = gate.evaluate(idle(16));
    expect(decision.render).toBe(false);
    expect(decision.reason).toBeNull();
  });

  it('draws every frame while audio is playing', () => {
    const gate = new RenderGate();
    gate.evaluate({nowMs: 0, elapsedMs: 0, isPlaying: true});
    // Same chart time, still playing: the looping animated textures advance on
    // the wall clock, so the frame is not a repeat.
    const decision = gate.evaluate({nowMs: 16, elapsedMs: 0, isPlaying: true});
    expect(decision).toEqual({
      render: true,
      reason: 'playing',
      keepAwake: true,
    });
  });

  it('draws when chart time moves while paused (a seek or a scrub)', () => {
    const gate = new RenderGate();
    gate.evaluate(idle(0, 1000));
    const decision = gate.evaluate(idle(16, 2000));
    expect(decision).toEqual({render: true, reason: 'time', keepAwake: true});
  });

  it('ignores chart-time noise below the epsilon', () => {
    const gate = new RenderGate();
    gate.evaluate(idle(0, 1000));
    expect(gate.evaluate(idle(16, 1000 + TIME_EPSILON_MS / 2)).render).toBe(
      false,
    );
    expect(gate.evaluate(idle(32, 1000 + TIME_EPSILON_MS * 2)).render).toBe(
      true,
    );
  });

  it('measures chart-time change against the last drawn frame, so slow drift still lands', () => {
    const gate = new RenderGate();
    gate.evaluate(idle(0, 1000));
    let elapsed = 1000;
    let drawn = false;
    // Each step is below the epsilon on its own; against the drawn anchor they
    // accumulate until a frame is owed.
    for (let i = 1; i <= 10; i++) {
      elapsed += TIME_EPSILON_MS / 2;
      if (gate.evaluate(idle(i * 16, elapsed)).render) drawn = true;
    }
    expect(drawn).toBe(true);
  });

  it('draws after a wake, whatever the clock says', () => {
    const gate = new RenderGate();
    gate.evaluate(idle(0));
    expect(gate.evaluate(idle(16)).render).toBe(false);
    gate.wake();
    expect(gate.evaluate(idle(32))).toEqual({
      render: true,
      reason: 'wake',
      keepAwake: true,
    });
  });

  it('coalesces repeated wakes into one frame', () => {
    const gate = new RenderGate();
    gate.evaluate(idle(0));
    gate.wake();
    gate.wake();
    gate.wake();
    expect(gate.evaluate(idle(16)).render).toBe(true);
    expect(gate.evaluate(idle(32)).render).toBe(false);
  });

  it('reports a pending wake without consuming it', () => {
    const gate = new RenderGate();
    gate.evaluate(idle(0));
    expect(gate.hasPendingWake).toBe(false);
    gate.wake();
    expect(gate.hasPendingWake).toBe(true);
    expect(gate.hasPendingWake).toBe(true);
    gate.evaluate(idle(16));
    expect(gate.hasPendingWake).toBe(false);
  });

  it('reasonToRender does not commit anything', () => {
    const gate = new RenderGate();
    gate.evaluate(idle(0, 1000));
    const input = idle(16, 2000);
    expect(gate.reasonToRender(input)).toBe('time');
    // Asking again still reports the same owed frame.
    expect(gate.reasonToRender(input)).toBe('time');
    expect(gate.evaluate(input).render).toBe(true);
    expect(gate.reasonToRender(idle(32, 2000))).toBeNull();
  });

  it('keeps the loop armed for the linger window after the last drawn frame', () => {
    const gate = new RenderGate();
    gate.evaluate(idle(0));
    expect(gate.evaluate(idle(DEFAULT_LINGER_MS - 1)).keepAwake).toBe(true);
    expect(gate.evaluate(idle(DEFAULT_LINGER_MS)).keepAwake).toBe(false);
  });

  it('honours a custom linger window', () => {
    const gate = new RenderGate({lingerMs: 100});
    gate.evaluate(idle(0));
    expect(gate.evaluate(idle(99)).keepAwake).toBe(true);
    expect(gate.evaluate(idle(100)).keepAwake).toBe(false);
  });

  it('restarts the linger window on every drawn frame', () => {
    const gate = new RenderGate({lingerMs: 100});
    gate.evaluate(idle(0));
    expect(gate.evaluate(idle(90)).keepAwake).toBe(true);
    gate.wake();
    expect(gate.evaluate(idle(95)).render).toBe(true);
    // 95 + 99 is far past the original window but inside the restarted one.
    expect(gate.evaluate(idle(194)).keepAwake).toBe(true);
    expect(gate.evaluate(idle(195)).keepAwake).toBe(false);
  });

  it('draws unconditionally again after a reset', () => {
    const gate = new RenderGate();
    gate.evaluate(idle(0, 1000));
    expect(gate.evaluate(idle(16, 1000)).render).toBe(false);
    gate.reset();
    expect(gate.evaluate(idle(32, 1000))).toEqual({
      render: true,
      reason: 'first',
      keepAwake: true,
    });
  });

  it('drops back to a repeat frame once playback stops', () => {
    const gate = new RenderGate();
    gate.evaluate({nowMs: 0, elapsedMs: 0, isPlaying: true});
    gate.evaluate({nowMs: 16, elapsedMs: 100, isPlaying: true});
    // Pause lands: this frame still differs in chart time, the next does not.
    expect(
      gate.evaluate({nowMs: 32, elapsedMs: 200, isPlaying: false}).reason,
    ).toBe('time');
    expect(
      gate.evaluate({nowMs: 48, elapsedMs: 200, isPlaying: false}).render,
    ).toBe(false);
  });
});
