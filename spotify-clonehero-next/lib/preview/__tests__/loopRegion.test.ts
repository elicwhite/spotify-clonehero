import {
  evaluateLoop,
  isUsableLoopRegion,
  seekEscapesLoop,
  MIN_LOOP_SPAN_MS,
  type LoopRegion,
} from '../loopRegion';

const REGION = {startMs: 1000, endMs: 3000};

describe('isUsableLoopRegion', () => {
  test('accepts a forward region', () => {
    expect(isUsableLoopRegion(REGION)).toBe(true);
  });

  test('rejects null, zero-length and inverted regions', () => {
    expect(isUsableLoopRegion(null)).toBe(false);
    expect(isUsableLoopRegion(undefined)).toBe(false);
    expect(isUsableLoopRegion({startMs: 1000, endMs: 1000})).toBe(false);
    expect(isUsableLoopRegion({startMs: 3000, endMs: 1000})).toBe(false);
  });

  test('rejects a region that ends before zero, where the clamped start would sit past the end', () => {
    expect(isUsableLoopRegion({startMs: -900, endMs: -100})).toBe(false);
    expect(isUsableLoopRegion({startMs: -900, endMs: 0})).toBe(false);
    expect(isUsableLoopRegion({startMs: -900, endMs: 500})).toBe(true);
  });

  test('rejects non-finite bounds', () => {
    expect(isUsableLoopRegion({startMs: NaN, endMs: 1000})).toBe(false);
    expect(isUsableLoopRegion({startMs: 0, endMs: Infinity})).toBe(false);
  });
});

describe('seekEscapesLoop', () => {
  test('a seek to or past the end escapes the loop', () => {
    expect(seekEscapesLoop(REGION, 3000)).toBe(true);
    expect(seekEscapesLoop(REGION, 9000)).toBe(true);
  });

  test('a seek anywhere before the end hands control back to the loop', () => {
    expect(seekEscapesLoop(REGION, 2999)).toBe(false);
    expect(seekEscapesLoop(REGION, 1000)).toBe(false);
    expect(seekEscapesLoop(REGION, 0)).toBe(false);
  });

  test('there is nothing to escape without a usable region', () => {
    expect(seekEscapesLoop(null, 9000)).toBe(false);
    expect(seekEscapesLoop({startMs: 3000, endMs: 1000}, 9000)).toBe(false);
    expect(seekEscapesLoop(REGION, NaN)).toBe(false);
  });
});

describe('evaluateLoop — A/B loop (confine: false)', () => {
  test('leaves playback alone inside the region', () => {
    expect(
      evaluateLoop({
        currentMs: 1500,
        region: REGION,
        isPlaying: true,
        escaped: false,
      }),
    ).toEqual({seekToMs: null, escaped: false});
  });

  test('wraps to the start once past the end', () => {
    expect(
      evaluateLoop({
        currentMs: 3010,
        region: REGION,
        isPlaying: true,
        escaped: false,
      }),
    ).toEqual({seekToMs: 1000, escaped: false});
  });

  test('wraps exactly at the end', () => {
    expect(
      evaluateLoop({
        currentMs: 3000,
        region: REGION,
        isPlaying: true,
        escaped: false,
      }).seekToMs,
    ).toBe(1000);
  });

  test('does not drag back a user who seeked past the end', () => {
    expect(
      evaluateLoop({
        currentMs: 9000,
        region: REGION,
        isPlaying: true,
        escaped: true,
      }),
    ).toEqual({seekToMs: null, escaped: true});
  });

  test('re-enters the loop when the playhead comes back before the end', () => {
    const past = evaluateLoop({
      currentMs: 9000,
      region: REGION,
      isPlaying: true,
      escaped: true,
    });
    const back = evaluateLoop({
      currentMs: 500,
      region: REGION,
      isPlaying: true,
      escaped: past.escaped,
    });
    expect(back).toEqual({seekToMs: null, escaped: false});

    expect(
      evaluateLoop({
        currentMs: 3200,
        region: REGION,
        isPlaying: true,
        escaped: back.escaped,
      }).seekToMs,
    ).toBe(1000);
  });

  test('does not jump forward when playback is still before the region', () => {
    expect(
      evaluateLoop({
        currentMs: 200,
        region: REGION,
        isPlaying: true,
        escaped: false,
      }),
    ).toEqual({seekToMs: null, escaped: false});
  });

  test('never seeks while paused, and keeps the escape latch for the resume', () => {
    expect(
      evaluateLoop({
        currentMs: 4000,
        region: REGION,
        isPlaying: false,
        escaped: true,
      }),
    ).toEqual({seekToMs: null, escaped: true});

    // Paused before the end, the loop is back in charge whenever play starts.
    expect(
      evaluateLoop({
        currentMs: 1200,
        region: REGION,
        isPlaying: false,
        escaped: true,
      }),
    ).toEqual({seekToMs: null, escaped: false});
  });

  test('a cleared, zero-length or inverted region never seeks', () => {
    for (const region of [
      null,
      {startMs: 2000, endMs: 2000},
      {startMs: 3000, endMs: 1000},
    ]) {
      expect(
        evaluateLoop({
          currentMs: 5000,
          region,
          isPlaying: true,
          escaped: false,
        }),
      ).toEqual({seekToMs: null, escaped: false});
    }
  });

  test('clamps a negative start to zero', () => {
    expect(
      evaluateLoop({
        currentMs: 2000,
        region: {startMs: -500, endMs: 1500},
        isPlaying: true,
        escaped: false,
      }).seekToMs,
    ).toBe(0);
  });

  test('a non-finite playhead is ignored and holds the latch', () => {
    expect(
      evaluateLoop({
        currentMs: NaN,
        region: REGION,
        isPlaying: true,
        escaped: true,
      }),
    ).toEqual({seekToMs: null, escaped: true});
  });
});

describe('evaluateLoop — moving the markers under the playhead', () => {
  /**
   * Installing a region clears the escape latch (`AudioManager` does this in
   * `#setActiveLoop`), which is what these cases model.
   */
  const afterRegionChange = (currentMs: number, region: LoopRegion) =>
    evaluateLoop({currentMs, region, isPlaying: true, escaped: false});

  test('regression: dragging the end flag behind the playhead still loops', () => {
    // Playing inside a 1s–8s loop at 5s...
    expect(
      evaluateLoop({
        currentMs: 5000,
        region: {startMs: 1000, endMs: 8000},
        isPlaying: true,
        escaped: false,
      }).seekToMs,
    ).toBeNull();

    // ...then the end flag is dragged back to 3s. The playhead is past the
    // end through no choice of the user's, so the next frame wraps.
    expect(afterRegionChange(5000, {startMs: 1000, endMs: 3000})).toEqual({
      seekToMs: 1000,
      escaped: false,
    });
  });

  test('dragging the start flag past the playhead plays into the region', () => {
    // Start moved ahead of the playhead: still before the end, so the loop
    // stays a one-way gate and playback runs in rather than jumping.
    expect(afterRegionChange(5000, {startMs: 6000, endMs: 8000})).toEqual({
      seekToMs: null,
      escaped: false,
    });
  });

  test('dragging the start flag behind the playhead leaves playback alone', () => {
    expect(afterRegionChange(5000, {startMs: 200, endMs: 8000})).toEqual({
      seekToMs: null,
      escaped: false,
    });
  });

  test.each([
    ['before the region', 200, null],
    ['inside the region', 2000, null],
    ['after the region', 5000, 1000],
  ] as const)(
    'a region set while paused takes effect when play starts %s',
    (_label, currentMs, seekToMs) => {
      // Setting it while paused never seeks on its own.
      expect(
        evaluateLoop({
          currentMs,
          region: REGION,
          isPlaying: false,
          escaped: false,
        }).seekToMs,
      ).toBeNull();

      expect(afterRegionChange(currentMs, REGION).seekToMs).toBe(seekToMs);
    },
  );

  test('a region squeezed to the minimum span wraps once instead of spinning', () => {
    const tight = {startMs: 2000, endMs: 2000 + MIN_LOOP_SPAN_MS};
    expect(isUsableLoopRegion(tight)).toBe(true);

    const wrapped = afterRegionChange(tight.endMs, tight);
    expect(wrapped.seekToMs).toBe(2000);

    // The wrap target is inside the region, so the next frame does nothing.
    expect(
      evaluateLoop({
        currentMs: wrapped.seekToMs!,
        region: tight,
        isPlaying: true,
        escaped: wrapped.escaped,
      }).seekToMs,
    ).toBeNull();
  });
});

describe('evaluateLoop — practice mode (confine: true)', () => {
  test('jumps forward into the section when the playhead is before it', () => {
    expect(
      evaluateLoop({
        currentMs: 200,
        region: REGION,
        isPlaying: true,
        escaped: false,
        confine: true,
      }),
    ).toEqual({seekToMs: 1000, escaped: false});
  });

  test('wraps past the end even when the user seeked out there', () => {
    expect(
      evaluateLoop({
        currentMs: 9000,
        region: REGION,
        isPlaying: true,
        escaped: true,
        confine: true,
      }),
    ).toEqual({seekToMs: 1000, escaped: false});
  });

  test('leaves playback alone inside the section', () => {
    expect(
      evaluateLoop({
        currentMs: 2000,
        region: REGION,
        isPlaying: true,
        escaped: false,
        confine: true,
      }),
    ).toEqual({seekToMs: null, escaped: false});
  });
});
