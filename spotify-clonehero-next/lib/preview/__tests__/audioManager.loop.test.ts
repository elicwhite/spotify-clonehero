/**
 * @jest-environment jsdom
 */

import {AudioManager} from '../audioManager';
import {installFakeWebAudio, FakeAudioContext} from './fakeWebAudio';

beforeAll(() => {
  installFakeWebAudio();
  // Keep the smoothing loop from running so `currentTime` stays on the raw
  // audio clock these tests drive by hand. In the app the same wrap check
  // runs from that loop every frame.
  global.requestAnimationFrame = () => 0;
  global.cancelAnimationFrame = () => {};
});

/** A buffer source that actually delivers its `ended` event, so tests can
 *  play a loop off the end of the audio instead of across its end marker. */
class EventfulSource {
  buffer: unknown = null;
  playbackRate = {
    value: 1,
    setValueAtTime(v: number) {
      this.value = v;
    },
  };
  #listeners = new Set<EventListener>();
  connect() {}
  disconnect() {}
  start() {}
  stop() {}
  addEventListener(type: string, listener: EventListener) {
    if (type === 'ended') this.#listeners.add(listener);
  }
  removeEventListener(_type: string, listener: EventListener) {
    this.#listeners.delete(listener);
  }
  fireEnded() {
    for (const listener of [...this.#listeners]) {
      listener({currentTarget: this} as unknown as Event);
    }
  }
}

async function makeAudioManager(): Promise<{
  am: AudioManager;
  ctx: FakeAudioContext;
  onSongEnded: jest.Mock;
  /** Ends every source the manager started, as the hardware would. */
  endAudio: () => void;
}> {
  const onSongEnded = jest.fn();
  const am = new AudioManager(
    [{fileName: 'song.ogg', data: new Uint8Array(8)}],
    onSongEnded,
  );
  await am.ready;
  const ctx = (window as unknown as {ctx: FakeAudioContext}).ctx;

  const live: EventfulSource[] = [];
  ctx.createBufferSource = () => {
    const source = new EventfulSource();
    live.push(source);
    return source as unknown as AudioBufferSourceNode;
  };

  return {
    am,
    ctx,
    onSongEnded,
    endAudio: () => {
      const sources = live.splice(0, live.length);
      for (const source of sources) source.fireEnded();
    },
  };
}

/** Move the audio hardware clock forward by `sec` of real time. */
function advance(ctx: FakeAudioContext, sec: number) {
  ctx.currentTime += sec;
}

/** One frame of the smoothing loop, which is where the wrap decision runs.
 *  `updateLoop` returns true when it wrapped. */
function frame(am: AudioManager): boolean {
  return am.updateLoop();
}

describe('AudioManager A/B loop', () => {
  test('wraps back to the loop start after crossing the end', async () => {
    const {am, ctx} = await makeAudioManager();
    am.setLoopRegion({startMs: 4000, endMs: 8000});

    await am.playChartTime(5);
    expect(frame(am)).toBe(false); // inside the region: doesn't seek
    advance(ctx, 3.5); // chart time 8.5 — past the end

    expect(frame(am)).toBe(true);
    expect(am.chartTime).toBeCloseTo(4, 5);
  });

  test('respects chartDelay when wrapping', async () => {
    const {am, ctx} = await makeAudioManager();
    am.setChartDelay(2);
    am.setLoopRegion({startMs: 4000, endMs: 8000});

    await am.playChartTime(5);
    expect(am.currentTime).toBeCloseTo(7, 5);
    expect(frame(am)).toBe(false);

    advance(ctx, 3.5);
    expect(frame(am)).toBe(true);
    expect(am.chartTime).toBeCloseTo(4, 5);
    expect(am.currentTime).toBeCloseTo(6, 5);
  });

  test('keeps looping on every subsequent pass', async () => {
    const {am, ctx} = await makeAudioManager();
    am.setLoopRegion({startMs: 4000, endMs: 8000});

    await am.playChartTime(4);
    expect(frame(am)).toBe(false);
    for (let pass = 0; pass < 3; pass++) {
      advance(ctx, 4.2);
      expect(frame(am)).toBe(true);
      expect(am.chartTime).toBeCloseTo(4, 5);
    }
  });

  test('does not drag back a user who seeked past the loop end', async () => {
    const {am} = await makeAudioManager();
    am.setLoopRegion({startMs: 4000, endMs: 8000});

    await am.playChartTime(20);

    expect(frame(am)).toBe(false);
    expect(am.chartTime).toBeCloseTo(20, 5);
  });

  test('a loop set mid-playback takes effect on the next crossing', async () => {
    const {am, ctx} = await makeAudioManager();
    await am.playChartTime(1);

    am.setLoopRegion({startMs: 4000, endMs: 8000});
    advance(ctx, 2); // chart time 3 — before the region, plays in
    expect(frame(am)).toBe(false);
    expect(am.chartTime).toBeCloseTo(3, 5);

    advance(ctx, 5.5); // chart time 8.5
    expect(frame(am)).toBe(true);
    expect(am.chartTime).toBeCloseTo(4, 5);
  });

  test('regression: dragging the end flag behind the playhead wraps on the next frame', async () => {
    const {am, ctx} = await makeAudioManager();
    am.setLoopRegion({startMs: 4000, endMs: 12_000});

    await am.playChartTime(5);
    advance(ctx, 2); // chart time 7 — still inside
    expect(frame(am)).toBe(false);

    // The end flag is dragged back behind the playhead.
    am.setLoopRegion({startMs: 4000, endMs: 6000});

    expect(frame(am)).toBe(true);
    expect(am.chartTime).toBeCloseTo(4, 5);
  });

  test('dragging the end flag behind the playhead wraps at a changed playback speed', async () => {
    const {am, ctx} = await makeAudioManager();
    am.setTempo(0.5);
    am.setLoopRegion({startMs: 4000, endMs: 12_000});

    await am.playChartTime(5);
    advance(ctx, 4); // 2s of chart time at 0.5x — chart time 7
    expect(am.chartTime).toBeCloseTo(7, 5);

    am.setLoopRegion({startMs: 4000, endMs: 6000});

    expect(frame(am)).toBe(true);
    expect(am.chartTime).toBeCloseTo(4, 5);
  });

  test('dragging the start flag past the playhead plays into the region', async () => {
    const {am, ctx} = await makeAudioManager();
    am.setLoopRegion({startMs: 4000, endMs: 12_000});

    await am.playChartTime(5);
    am.setLoopRegion({startMs: 8000, endMs: 12_000});

    expect(frame(am)).toBe(false);
    expect(am.chartTime).toBeCloseTo(5, 5);

    advance(ctx, 7.5); // chart time 12.5 — past the end
    expect(frame(am)).toBe(true);
    expect(am.chartTime).toBeCloseTo(8, 5);
  });

  test('a region set while paused past the playhead wraps once playback starts', async () => {
    const {am} = await makeAudioManager();
    await am.playChartTime(20);
    await am.pause();
    am.setLoopRegion({startMs: 4000, endMs: 8000});

    expect(frame(am)).toBe(false); // paused: nothing moves

    await am.resume();
    expect(frame(am)).toBe(true);
    expect(am.chartTime).toBeCloseTo(4, 5);
  });

  test('seeking past the end while paused leaves the user there on resume', async () => {
    const {am} = await makeAudioManager();
    am.setLoopRegion({startMs: 4000, endMs: 8000});

    await am.playChartTime(5);
    await am.pause();
    await am.seekToChartTime(20);
    await am.resume();

    expect(frame(am)).toBe(false);
    expect(am.chartTime).toBeCloseTo(20, 5);
  });

  test('seeking back inside the loop while paused hands control back', async () => {
    const {am, ctx} = await makeAudioManager();
    am.setLoopRegion({startMs: 4000, endMs: 8000});

    await am.playChartTime(20); // escapes the loop
    await am.pause();
    await am.seekToChartTime(5);
    await am.resume();

    advance(ctx, 3.5); // chart time 8.5
    expect(frame(am)).toBe(true);
    expect(am.chartTime).toBeCloseTo(4, 5);
  });

  test('a seek is judged in chart time, not audio time, under a chart delay', async () => {
    const {am, ctx} = await makeAudioManager();
    // With this delay the audio clock reads 15s at chart time 5s: judging the
    // seek on the audio clock would read as past the 8s end and wrongly
    // release the loop.
    am.setChartDelay(10);
    am.setLoopRegion({startMs: 4000, endMs: 8000});

    await am.playChartTime(5);
    expect(am.currentTime).toBeCloseTo(15, 5);

    advance(ctx, 3.5); // chart time 8.5
    expect(frame(am)).toBe(true);
    expect(am.chartTime).toBeCloseTo(4, 5);
  });

  test('clearing the loop stops the wrapping', async () => {
    const {am, ctx} = await makeAudioManager();
    am.setLoopRegion({startMs: 4000, endMs: 8000});
    await am.playChartTime(5);

    am.setLoopRegion(null);
    advance(ctx, 4);

    expect(am.getLoopRegion()).toBeNull();
    expect(frame(am)).toBe(false);
    expect(am.chartTime).toBeCloseTo(9, 5);
  });

  test('a zero-length or inverted region is ignored rather than spinning', async () => {
    const {am, ctx} = await makeAudioManager();

    for (const region of [
      {startMs: 5000, endMs: 5000},
      {startMs: 8000, endMs: 4000},
    ]) {
      am.setLoopRegion(region);
      expect(am.getLoopRegion()).toBeNull();

      await am.playChartTime(5);
      advance(ctx, 5);
      expect(frame(am)).toBe(false);
      expect(am.chartTime).toBeCloseTo(10, 5);
    }
  });

  test('wraps on chart time, not real time, at a changed playback speed', async () => {
    const {am, ctx} = await makeAudioManager();
    am.setLoopRegion({startMs: 4000, endMs: 8000});
    am.setTempo(2);

    await am.playChartTime(4);
    expect(frame(am)).toBe(false);

    advance(ctx, 1.5); // 3s of chart time at 2x — still inside
    expect(frame(am)).toBe(false);
    expect(am.chartTime).toBeCloseTo(7, 5);

    advance(ctx, 1); // 2s more — past the end
    expect(frame(am)).toBe(true);
    expect(am.chartTime).toBeCloseTo(4, 5);
  });

  test('pausing past the loop end does not wrap on the paused clock', async () => {
    const {am, ctx} = await makeAudioManager();
    am.setLoopRegion({startMs: 4000, endMs: 8000});
    await am.playChartTime(5);
    advance(ctx, 4);
    await am.pause();

    expect(frame(am)).toBe(false);
    expect(am.chartTime).toBeCloseTo(9, 5);
  });

  test('running out of audio inside the loop wraps instead of ending', async () => {
    const {am, endAudio, onSongEnded} = await makeAudioManager();
    // End marker past the 60s buffer, so the audio runs out first.
    am.setLoopRegion({startMs: 50_000, endMs: 90_000});

    await am.playChartTime(50);
    expect(frame(am)).toBe(false); // inside the region: doesn't seek

    endAudio();

    expect(onSongEnded).not.toHaveBeenCalled();
    expect(am.chartTime).toBeCloseTo(50, 5);
  });

  test('running out of audio past the loop ends the song', async () => {
    const {am, endAudio, onSongEnded} = await makeAudioManager();
    am.setLoopRegion({startMs: 4000, endMs: 8000});

    // Seeked past the end: the user escaped the loop, so the song is free to
    // end rather than jumping back into a region they left.
    await am.playChartTime(50);
    expect(frame(am)).toBe(false);

    endAudio();

    expect(onSongEnded).toHaveBeenCalledTimes(1);
  });

  test('setting an A/B loop replaces a practice section', async () => {
    const {am} = await makeAudioManager();
    am.setPracticeMode({
      startMeasureMs: 6000,
      endMeasureMs: 10000,
      startTimeMs: 6000,
      endTimeMs: 10000,
    });

    am.setLoopRegion({startMs: 4000, endMs: 8000});

    expect(am.getLoopRegion()).toEqual({startMs: 4000, endMs: 8000});
    // The practice section's confinement is gone with it: a playhead before
    // the region plays in rather than being dragged forward.
    await am.playChartTime(1);
    expect(frame(am)).toBe(false);
    expect(am.chartTime).toBeCloseTo(1, 5);
  });
});

describe('AudioManager practice mode', () => {
  test('confines the playhead to the section from both sides', async () => {
    const {am, ctx} = await makeAudioManager();
    am.setPracticeMode({
      startMeasureMs: 6000,
      endMeasureMs: 10000,
      startTimeMs: 4000,
      endTimeMs: 10000,
    });

    // Before the section: jumps forward into it.
    await am.play({time: 1});
    expect(frame(am)).toBe(true);
    expect(am.currentTime).toBeCloseTo(4, 5);

    // Past the end: wraps back even without having played the section.
    await am.play({time: 30});
    expect(frame(am)).toBe(true);
    expect(am.currentTime).toBeCloseTo(4, 5);

    // Inside: left alone.
    advance(ctx, 1);
    expect(frame(am)).toBe(false);
    expect(am.currentTime).toBeCloseTo(5, 5);
  });

  test('wraps at the end of the audio even for a user who seeked past the section', async () => {
    const {am, endAudio, onSongEnded} = await makeAudioManager();
    am.setPracticeMode({
      startMeasureMs: 6000,
      endMeasureMs: 90_000,
      startTimeMs: 4000,
      endTimeMs: 90_000,
    });

    await am.play({time: 50});
    endAudio();

    expect(onSongEnded).not.toHaveBeenCalled();
    expect(am.currentTime).toBeCloseTo(4, 5);
  });

  test('is a practice section, not an A/B loop', async () => {
    const {am} = await makeAudioManager();
    am.setPracticeMode({
      startMeasureMs: 6000,
      endMeasureMs: 10000,
      startTimeMs: 4000,
      endTimeMs: 10000,
    });
    expect(am.getLoopRegion()).toBeNull();

    am.setPracticeMode(null);
    expect(frame(am)).toBe(false);
  });
});
