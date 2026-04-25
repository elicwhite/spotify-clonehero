import {LyricsState, TRANSITION_DURATION_MS} from '../LyricsOverlay';
import type {LyricLine} from '@/lib/karaoke/parse-lyrics';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLine(
  phraseStartMs: number,
  phraseEndMs: number,
  syllables: {text: string; msTime: number}[],
): LyricLine {
  return {
    phraseStartMs,
    phraseEndMs,
    syllables,
    text: syllables.map(s => s.text).join(''),
  };
}

/** Two lines with a short gap (< PHRASE_DISTANCE_THRESHOLD_MS). */
function twoCloseLines(): LyricLine[] {
  return [
    makeLine(1000, 3000, [
      {text: "I'm ", msTime: 1000},
      {text: 'stand', msTime: 1500},
      {text: 'ing ', msTime: 1800},
      {text: 'out ', msTime: 2100},
      {text: 'your ', msTime: 2400},
      {text: 'window', msTime: 2700},
    ]),
    makeLine(3500, 5500, [
      {text: 'Hey ', msTime: 3500},
      {text: 'little ', msTime: 3800},
      {text: 'sister ', msTime: 4100},
      {text: 'can ', msTime: 4400},
      {text: 'I ', msTime: 4700},
      {text: 'come ', msTime: 5000},
      {text: 'inside?', msTime: 5200},
    ]),
  ];
}

/** Two lines with a long gap (> PHRASE_DISTANCE_THRESHOLD_MS). */
function twoFarLines(): LyricLine[] {
  return [
    makeLine(1000, 3000, [
      {text: 'Hello', msTime: 1000},
      {text: ' world', msTime: 2000},
    ]),
    makeLine(8000, 10000, [
      {text: 'Good', msTime: 8000},
      {text: 'bye', msTime: 9000},
    ]),
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LyricsState', () => {
  describe('empty lyrics', () => {
    it('always returns zero opacity', () => {
      const state = new LyricsState([]);
      const snap = state.update(5000);
      expect(snap.lineIndex).toBe(-1);
      expect(snap.syllableIndex).toBe(-1);
      expect(snap.opacity).toBe(0);
    });
  });

  describe('line tracking', () => {
    it('returns -1 before any lyrics start', () => {
      const state = new LyricsState(twoCloseLines());
      const snap = state.update(0);
      expect(snap.lineIndex).toBe(-1);
    });

    it('activates first line at its start time', () => {
      const state = new LyricsState(twoCloseLines());
      const snap = state.update(1000);
      expect(snap.lineIndex).toBe(0);
    });

    it('advances to second line when its start time arrives', () => {
      const state = new LyricsState(twoCloseLines());
      // Simulate normal playback: advance frame by frame
      state.update(1000);
      state.update(2000);
      state.update(3000);
      const snap = state.update(3500);
      expect(snap.lineIndex).toBe(1);
    });

    it('stays on last line after end', () => {
      const state = new LyricsState(twoCloseLines());
      state.update(1000);
      state.update(3500);
      const snap = state.update(6000);
      expect(snap.lineIndex).toBe(1);
    });
  });

  describe('syllable tracking', () => {
    it('returns -1 before first syllable in line', () => {
      const state = new LyricsState(twoCloseLines());
      // At fade-in time, before actual syllable start
      const snap = state.update(500);
      expect(snap.syllableIndex).toBe(-1);
    });

    it('tracks syllable progression within a line', () => {
      const state = new LyricsState(twoCloseLines());

      let snap = state.update(1000);
      expect(snap.syllableIndex).toBe(0); // "I'm "

      snap = state.update(1500);
      expect(snap.syllableIndex).toBe(1); // "stand"

      snap = state.update(1800);
      expect(snap.syllableIndex).toBe(2); // "ing "

      snap = state.update(2700);
      expect(snap.syllableIndex).toBe(5); // "window"
    });

    it('resets syllable index when advancing to next line', () => {
      const state = new LyricsState(twoCloseLines());
      state.update(1000);
      state.update(2700);
      const snap = state.update(3500);
      expect(snap.lineIndex).toBe(1);
      expect(snap.syllableIndex).toBe(0); // "Hey "
    });
  });

  describe('seek detection', () => {
    it('handles backward seek', () => {
      const state = new LyricsState(twoCloseLines());
      state.update(4000); // line 1
      const snap = state.update(1200); // seek back to line 0
      expect(snap.lineIndex).toBe(0);
      expect(snap.syllableIndex).toBe(0);
    });

    it('handles large forward jump', () => {
      const state = new LyricsState(twoCloseLines());
      state.update(1000);
      // Jump forward by > 5000ms triggers binary search
      const snap = state.update(7000);
      expect(snap.lineIndex).toBe(1);
    });
  });

  describe('opacity / fading', () => {
    it('is 0 well before first line', () => {
      const state = new LyricsState(twoCloseLines());
      expect(state.update(0).opacity).toBe(0);
    });

    it('fades in before first line starts', () => {
      const state = new LyricsState(twoCloseLines());
      // First line starts at 1000, fade begins at 1000 - 500 = 500
      const snap = state.update(750); // halfway through fade
      expect(snap.opacity).toBeCloseTo(0.5, 1);
    });

    it('is fully opaque during a line', () => {
      const state = new LyricsState(twoCloseLines());
      expect(state.update(2000).opacity).toBe(1);
    });

    it('stays opaque in short gap between close lines', () => {
      const lines = twoCloseLines();
      // Gap = 3500 - 3000 = 500ms < PHRASE_DISTANCE_THRESHOLD_MS
      const state = new LyricsState(lines);
      state.update(2000);
      const snap = state.update(3200); // in the gap
      expect(snap.opacity).toBe(1);
    });

    it('fades out after last line ends', () => {
      const lines = twoCloseLines();
      const state = new LyricsState(lines);
      state.update(3500);
      state.update(5500); // at phraseEndMs of line 1

      // 250ms into fade (half of 500ms) from phraseEndMs
      const snap = state.update(5750);
      expect(snap.opacity).toBeCloseTo(0.5, 1);
    });

    it('is 0 well after last line ends', () => {
      const state = new LyricsState(twoCloseLines());
      state.update(3500);
      state.update(5500);
      const snap = state.update(7000);
      expect(snap.opacity).toBe(0);
    });

    it('fades out and back in during long gap', () => {
      const state = new LyricsState(twoFarLines());
      // Line 0 phraseEndMs=3000, line 1 phraseStartMs=8000 (gap = 5000ms)

      state.update(2000);

      // Just past phraseEnd — fading out (250ms into 500ms fade)
      const fadeOut = state.update(3250);
      expect(fadeOut.opacity).toBeCloseTo(0.5, 1);

      // Fully faded out (past 3500)
      const hidden = state.update(5000);
      expect(hidden.opacity).toBe(0);

      // Fade in for next line (starts at 8000 - 500 = 7500)
      const fadeIn = state.update(7750);
      expect(fadeIn.opacity).toBeCloseTo(0.5, 1);
    });
  });

  describe('upcoming line visibility', () => {
    it('shows upcoming line when gap is short', () => {
      const state = new LyricsState(twoCloseLines());
      const snap = state.update(2000);
      expect(snap.showUpcoming).toBe(true);
    });

    it('does not show upcoming line when gap is long', () => {
      const state = new LyricsState(twoFarLines());
      const snap = state.update(2000);
      expect(snap.showUpcoming).toBe(false);
    });

    it('does not show upcoming during long gap', () => {
      const state = new LyricsState(twoFarLines());
      state.update(2000);
      const snap = state.update(3100); // past last syllable, long gap
      expect(snap.showUpcoming).toBe(false);
    });

    it('does not show upcoming when on last line', () => {
      const state = new LyricsState(twoCloseLines());
      state.update(1000);
      const snap = state.update(4000); // on line 1 (last)
      expect(snap.showUpcoming).toBe(false);
    });
  });

  describe('line transitions', () => {
    it('starts transition when line advances', () => {
      const state = new LyricsState(twoCloseLines());
      state.update(2000); // on line 0
      state.update(3500); // advances to line 1, transition starts (progress = 0 at start)
      // Next frame shows progress > 0
      const snap = state.update(3550);
      expect(snap.lineIndex).toBe(1);
      expect(snap.transitionProgress).toBeGreaterThan(0);
      expect(snap.transitionProgress).toBeLessThan(1);
    });

    it('transition progresses over time', () => {
      const state = new LyricsState(twoCloseLines());
      state.update(2000);
      state.update(3500); // transition starts

      // Halfway through transition
      const mid = state.update(3500 + TRANSITION_DURATION_MS / 2);
      expect(mid.transitionProgress).toBeGreaterThan(0.4);
      expect(mid.transitionProgress).toBeLessThan(0.6);
    });

    it('transition completes and resets to 0', () => {
      const state = new LyricsState(twoCloseLines());
      state.update(2000);
      state.update(3500);
      const snap = state.update(3500 + TRANSITION_DURATION_MS + 50);
      expect(snap.transitionProgress).toBe(0);
    });

    it('cancels transition on seek', () => {
      const state = new LyricsState(twoCloseLines());
      state.update(2000);
      state.update(3500); // transition starts

      // Seek backward (>100ms jump back triggers binary search)
      const snap = state.update(1000);
      expect(snap.transitionProgress).toBe(0);
    });

    it('no transition on first line appearance', () => {
      const state = new LyricsState(twoCloseLines());
      const snap = state.update(1000); // first line appears
      expect(snap.lineIndex).toBe(0);
      expect(snap.transitionProgress).toBe(0);
    });

    it('no slide transition after long gap', () => {
      const state = new LyricsState(twoFarLines());
      state.update(2000); // on line 0
      // Advance past phraseEndMs + fade (3000 + 500 = 3500)
      state.update(4000);
      expect(state.update(4000).lineIndex).toBe(1); // early advance
      expect(state.update(4000).isTransitioning).toBe(false); // no slide
    });
  });

  describe('long-gap full sequence', () => {
    it('plays line → fades out → hidden → advances → fades in → plays next', () => {
      const state = new LyricsState(twoFarLines());
      // Line 0: phraseStart=1000, phraseEnd=3000
      // Line 1: phraseStart=8000, phraseEnd=10000

      // 1. Playing line 0
      let snap = state.update(1500);
      expect(snap.lineIndex).toBe(0);
      expect(snap.opacity).toBe(1);
      expect(snap.syllableIndex).toBe(0);

      // 2. Past phraseEnd — fading out
      snap = state.update(3100);
      expect(snap.lineIndex).toBe(0);
      expect(snap.opacity).toBeGreaterThan(0);
      expect(snap.opacity).toBeLessThan(1);

      // 3. Fully faded out
      snap = state.update(3600);
      expect(snap.opacity).toBe(0);

      // 4. Early advance to line 1 (after fade-out complete)
      snap = state.update(4000);
      expect(snap.lineIndex).toBe(1);
      expect(snap.opacity).toBe(0); // still hidden
      expect(snap.isTransitioning).toBe(false); // no slide

      // 5. Still hidden in the middle of the gap
      snap = state.update(6000);
      expect(snap.lineIndex).toBe(1);
      expect(snap.opacity).toBe(0);

      // 6. Fade in starts (phraseStart - PHRASE_FADE_MS = 7500)
      snap = state.update(7750);
      expect(snap.lineIndex).toBe(1);
      expect(snap.opacity).toBeGreaterThan(0);
      expect(snap.opacity).toBeLessThan(1);

      // 7. Fully visible, playing line 1
      snap = state.update(8500);
      expect(snap.lineIndex).toBe(1);
      expect(snap.opacity).toBe(1);
      expect(snap.syllableIndex).toBe(0);

      // 8. Seek back to line 0 works correctly
      snap = state.update(1500);
      expect(snap.lineIndex).toBe(0);
      expect(snap.opacity).toBe(1);
    });
  });
});
