import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {endCardTiming, END_CARD_TIMING} from '../src/brand/endCardTiming';
import {POP_ENTERS, POP_EXITS} from '../src/fx/Pop';
import {
  elapsedSec,
  enterPresets,
  exitPresets,
  resolveEnter,
  resolveExit,
  type UnitContext,
} from '../src/text/presets';
import {
  fullyInFrame,
  kineticTimeline,
  wholeFrameAtOrAfter,
} from '../src/text/timing';
import {composeStyle, unitCss} from '../src/text/unitStyle';
import {
  chapterSlateTiming,
  eyebrowGone,
  eyebrowLabelTiming,
  SLATE_EXITS,
} from '../src/ui/slateTiming';

const close = (a: number, b: number, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

const maskUp = enterPresets.maskUp;
const maskUpOut = exitPresets.maskUpOut;

describe('kineticTimeline', () => {
  it('counts words across line breaks and staggers them in reading order', () => {
    const t = kineticTimeline({
      text: 'one two\nthree four five',
      fps: 60,
      enterAt: 100,
    });
    assert.equal(t.split, 'words');
    assert.equal(t.wordCount, 5);
    assert.equal(t.units.length, 5);
    t.units.forEach((u, i) => {
      assert.equal(u.word, i);
      close(u.start, 100 + i * maskUp.stagger * 60);
      close(u.land, u.start + maskUp.duration * 60);
      assert.equal(u.exitStart, Infinity);
    });
    assert.equal(t.firstStart, 100);
  });

  it('lands and leaves on whole film frames', () => {
    const t = kineticTimeline({
      text: 'one two three',
      fps: 60,
      enterAt: 100.3,
      exitAt: 300.2,
    });
    const lastLand = Math.max(...t.units.map(u => u.land));
    const lastGone = Math.max(...t.units.map(u => u.exitEnd));
    assert.equal(t.fullyIn, Math.ceil(lastLand));
    assert.ok(Number.isInteger(t.fullyIn) && t.fullyIn >= lastLand);
    assert.equal(t.gone, Math.ceil(lastGone));
    close(
      lastGone,
      300.2 + 2 * maskUpOut.stagger * 60 + maskUpOut.duration * 60,
      1e-9,
    );
    assert.equal(
      fullyInFrame({text: 'one two three', fps: 60, enterAt: 100.3}),
      t.fullyIn,
    );
  });

  it('forgives float error just past a whole frame', () => {
    assert.equal(wholeFrameAtOrAfter(194), 194);
    assert.equal(wholeFrameAtOrAfter(194 + 1e-9), 194);
    assert.equal(wholeFrameAtOrAfter(193.8), 194);
    assert.equal(wholeFrameAtOrAfter(Infinity), Infinity);
  });

  it('holds the same seconds at any frame rate', () => {
    const at60 = kineticTimeline({text: 'a b c d', fps: 60, enterAt: 120});
    const at30 = kineticTimeline({text: 'a b c d', fps: 30, enterAt: 60});
    at60.units.forEach((u, i) => {
      close(u.start / 60, (at30.units[i]?.start ?? NaN) / 30);
      close(u.land / 60, (at30.units[i]?.land ?? NaN) / 30);
    });
  });

  it('starts each word on its own frame in chars mode, its letters following', () => {
    const t = kineticTimeline({
      text: 'ab cde',
      fps: 60,
      enter: 'typeOn',
      enterAt: [10, 50],
    });
    assert.equal(t.split, 'chars');
    const each = enterPresets.typeOn.stagger * 60;
    assert.deepEqual(
      t.units.map(u => [u.word, u.char]),
      [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
        [1, 2],
      ],
    );
    close(t.units[0]?.start ?? NaN, 10);
    close(t.units[1]?.start ?? NaN, 10 + each);
    close(t.units[2]?.start ?? NaN, 50);
    close(t.units[4]?.start ?? NaN, 50 + 2 * each);
  });

  it('leaves a line without enterAt at rest', () => {
    const t = kineticTimeline({text: 'at rest', fps: 60});
    assert.equal(t.firstStart, -Infinity);
    assert.equal(t.fullyIn, -Infinity);
    assert.equal(t.gone, Infinity);
  });
});

describe('slate timing', () => {
  const slate = {
    eyebrow: 'Drum transcription',
    headline: 'Turn a song\ninto a first-pass chart',
    caption: 'A model proposes notes.',
    enterAt: 10,
    exitAt: 200,
  };

  it('starts the caption as the headline last word lands, across line breaks', () => {
    const t = chapterSlateTiming(slate, 60);
    // Turn, a, song / into, a, first-pass, chart.
    assert.equal(t.headline.units.length, 7);
    const lastStart = 10 + 60 / 6 + 6 * maskUp.stagger * 60;
    close(
      t.caption?.units[0]?.start ?? NaN,
      lastStart + 0.6 * maskUp.duration * 60,
    );
  });

  it('is gone on the first whole frame every part is', () => {
    const t = chapterSlateTiming(slate, 60);
    const eyebrow = eyebrowGone(slate.eyebrow, {enterAt: 10, exitAt: 200}, 60);
    const parts = [eyebrow, t.headline.gone, t.caption?.gone ?? -Infinity];
    assert.equal(t.gone, Math.max(...parts));
    assert.ok(Number.isInteger(t.gone));
    const captionGone = kineticTimeline({
      ...(t.captionOptions ?? {text: ''}),
      fps: 60,
    }).gone;
    assert.equal(t.caption?.gone, captionGone);
  });

  it('waits for the scrim when there is one', () => {
    const t = chapterSlateTiming({...slate, caption: undefined, scrim: 1}, 60);
    assert.ok(t.gone >= 200 + 0.27 * 60);
  });

  it('times the exits in seconds', () => {
    const at60 = chapterSlateTiming(slate, 60);
    const at30 = chapterSlateTiming({...slate, enterAt: 5, exitAt: 100}, 30);
    close(
      at60.headlineOptions.exitAt as number,
      200 + SLATE_EXITS.maskUp.headlineDelaySec * 60,
    );
    close(
      (at60.captionOptions?.exitAt as number) / 60,
      (at30.captionOptions?.exitAt as number) / 30,
    );
  });

  it('types the eyebrow 0.1 s after its bar and keeps it on screen without an exit', () => {
    const label = eyebrowLabelTiming('Tempo map', {enterAt: 30}, 60);
    assert.equal(label.enter, 'typeOn');
    close(label.enterAt as number, 36);
    assert.equal(eyebrowGone('Tempo map', {enterAt: 30}, 60), Infinity);
  });
});

describe('unit styles', () => {
  it('add offsets, multiply scales and opacity, and let the later weight win', () => {
    const s = composeStyle(
      {x: 4, y: 10, scale: 0.5, opacity: 0.5, blur: 2, weight: 400},
      {y: -4, scale: 3, opacity: 0.5, blur: 1, weight: 700},
    );
    assert.equal(s.x, 4);
    assert.equal(s.y, 6);
    assert.equal(s.scale, 1.5);
    assert.equal(s.opacity, 0.25);
    assert.equal(s.blur, 3);
    assert.equal(s.weight, 700);
  });

  it('lays a delta over its element: base transform first, opacities multiplied, filters chained', () => {
    const css = unitCss(
      {y: 12, opacity: 0.5, blur: 4},
      {
        base: {
          position: 'absolute',
          transform: 'rotate(3deg)',
          opacity: 0.8,
          filter: 'saturate(1.2)',
        },
        perspective: 500,
      },
    );
    assert.equal(css.position, 'absolute');
    assert.equal(css.transform, 'rotate(3deg) translate(0px, 12px)');
    close(css.opacity as number, 0.4);
    assert.equal(css.filter, 'saturate(1.2) blur(4px)');
  });

  it('keeps the base as it is at rest', () => {
    const base = {transform: 'scale(2)', opacity: 0.7, filter: 'blur(1px)'};
    const css = unitCss({}, {base, perspective: 500});
    assert.equal(css.transform, 'scale(2)');
    assert.equal(css.opacity, 0.7);
    assert.equal(css.filter, 'blur(1px)');
  });

  it('draws a directional blur with the SVG filter it is handed', () => {
    const css = unitCss(
      {blurX: 6},
      {perspective: 500, directionalFilter: 'url(#f)'},
    );
    assert.equal(css.filter, 'url(#f)');
  });
});

describe('presets in time', () => {
  const ctx = (durationFrames: number, fps: number): UnitContext => ({
    index: 0,
    count: 1,
    line: 0,
    lineCount: 1,
    word: 0,
    char: -1,
    text: 'x',
    width: 40,
    lineHeight: 40,
    fontSize: 40,
    padTop: 0,
    padBottom: 0,
    seed: 'x',
    frame: 0,
    start: 0,
    durationFrames,
    fps,
    unit: 1,
  });

  it('hand a spring the same seconds at any frame rate', () => {
    close(elapsedSec(0.5, ctx(48, 60)), 0.4);
    close(elapsedSec(0.5, ctx(24, 30)), 0.4);
    const pop = enterPresets.scalePop;
    const at60 = pop.style(0.3, ctx(pop.duration * 60, 60));
    const at30 = pop.style(0.3, ctx(pop.duration * 30, 30));
    close(at60.scale ?? NaN, at30.scale ?? NaN);
  });

  it('give Pop only presets that work on a whole element', () => {
    for (const name of POP_ENTERS) {
      assert.ok(!resolveEnter(name).mask, `${name} needs a line mask`);
      assert.ok(!resolveEnter(name).caret, `${name} draws a caret`);
    }
    for (const name of POP_EXITS)
      assert.ok(!resolveExit(name).mask, `${name} needs a line mask`);
  });
});

describe('end card timing', () => {
  const card = {
    at: 100,
    title: 'Chart Editor',
    url: 'musiccharts.tools/example',
    tagline: 'Runs in your browser.',
  };

  it('builds from `at` in seconds, the tagline and credit after the URL', () => {
    const t = endCardTiming(card, 60);
    close(
      t.titleOptions.enterAt as number,
      100 + END_CARD_TIMING.titleDelaySec * 60,
    );
    close(t.urlOptions.enterAt as number, 100 + 60);
    close(t.taglineOptions?.enterAt as number, 160 + 6);
    close(t.creditAt, 160 + 54);
    const at30 = endCardTiming({...card, at: 50}, 30);
    close((t.creditAt - 100) / 60, (at30.creditAt - 50) / 30);
  });

  it('is fully in when each line says so', () => {
    const t = endCardTiming(card, 60);
    assert.equal(
      t.title.fullyIn,
      fullyInFrame({text: card.title, fps: 60, enter: 'flipUp', enterAt: 124}),
    );
    assert.ok(Number.isInteger(t.url.fullyIn) && t.url.fullyIn > 160);
    assert.equal(
      endCardTiming({...card, tagline: undefined}, 60).tagline,
      null,
    );
  });
});
