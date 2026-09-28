/**
 * Where the highway geometry puts things on screen, computed through the
 * app's own camera builder (`createHighwayCamera` and `fitHighwayCamera`,
 * loaded from the app's sources) and checked against the app's camera
 * model: the strikeline where the fit puts it, narrow panes that keep their
 * highway inside, and the lane each note type draws in.
 */
import './fixtures/product-resolve.mjs';
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {noteTypes} from '@eliwhite/scan-chart';
import {
  HIGHWAY_CAMERA,
  strikelineInCameraSpace,
} from '../../../spotify-clonehero-next/lib/preview/highway/cameraFit';
import {STRIKELINE_Y} from '../src/highway/floor';

const {
  gemCentre,
  highwayPoint,
  highwayQuad,
  laneOfNoteType,
  paneRects,
  stageLayout,
} = await import('../src/highway/highwayGeometry.ts');

const near = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

const WIDE = {width: 1920, height: 1080};

/** Where the strikeline sits down a pane, as a fraction of its height, when the fit changes nothing. */
const baseStrikelineFraction = (): number => {
  const {depth, viewY} = strikelineInCameraSpace();
  const tan = Math.tan((HIGHWAY_CAMERA.fovDeg * Math.PI) / 360);
  return (1 - viewY / (depth * tan)) / 2;
};

describe("the highway geometry, through the app's camera", () => {
  it("puts the strikeline where the app's camera model does", () => {
    const [rect] = paneRects(WIDE, 1);
    assert.ok(rect);
    for (const instrument of ['drums', 'guitar'] as const) {
      const p = highwayPoint({
        box: WIDE,
        instrument,
        lane: instrument === 'drums' ? 'kick' : 'open',
        nowSec: 12,
      });
      near(p.x, rect.x + rect.width / 2);
      near(p.y, rect.y + baseStrikelineFraction() * rect.height);
    }
  });

  it('keeps each narrow pane’s highway inside it, the strikeline where a wide pane has it', () => {
    const box = {width: 900, height: 900};
    const rects = paneRects(box, 3);
    assert.equal(rects.length, 3);
    rects.forEach((rect, paneIndex) => {
      const strikeline = highwayQuad(
        rect,
        'guitar',
        STRIKELINE_Y,
        STRIKELINE_Y + 0.5,
      );
      for (const corner of strikeline)
        assert.ok(
          corner.x > rect.x && corner.x < rect.x + rect.width,
          `pane ${paneIndex}: ${corner.x} is outside ${rect.x}..${rect.x + rect.width}`,
        );
      const centre = highwayPoint({
        box,
        paneCount: 3,
        paneIndex,
        instrument: 'guitar',
        lane: 'open',
        nowSec: 3,
      });
      near((centre.y - rect.y) / rect.height, baseStrikelineFraction());
    });
  });

  it("puts a gem's centre straight above its anchor, by less the further up the highway it is", () => {
    const query = {box: WIDE, instrument: 'drums', lane: 'red'} as const;
    const lift = (atSec: number) => {
      const anchor = highwayPoint({...query, atSec, nowSec: 10});
      const centre = gemCentre({...query, atSec, nowSec: 10});
      near(centre.x, anchor.x, 1e-9);
      return anchor.y - centre.y;
    };
    const near1 = lift(10.1);
    const far1 = lift(10.5);
    assert.ok(near1 > 0 && far1 > 0, `lifts ${near1}, ${far1}`);
    assert.ok(far1 < near1, `a far gem lifts ${far1} px, a near one ${near1}`);
  });

  it('lays out panes once, the way the editor does', () => {
    assert.deepEqual(paneRects(WIDE, 2), stageLayout(WIDE, 2).highways);
  });

  it('names the lane of every note type, and refuses a type the highway lacks', () => {
    assert.equal(laneOfNoteType('drums', noteTypes.kick), 'kick');
    assert.equal(laneOfNoteType('drums', noteTypes.redDrum), 'red');
    assert.equal(laneOfNoteType('drums', noteTypes.greenDrum), 'green');
    assert.equal(laneOfNoteType('guitar', noteTypes.open), 'open');
    assert.equal(laneOfNoteType('guitar', noteTypes.green), 0);
    assert.equal(laneOfNoteType('guitar', noteTypes.orange), 4);
    assert.throws(
      () => laneOfNoteType('drums', noteTypes.orange),
      /has no lane on the drums highway/,
    );
  });
});
