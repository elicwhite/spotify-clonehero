import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {layoutOf} from '../src/brand/layout';
import {space} from '../src/brand/tokens';
import {formatOf, SAFE_MARGIN, toFrames, toSec} from '../src/format/format';

const landscape = formatOf({
  fps: 60,
  width: 1920,
  height: 1080,
  durationInFrames: 1,
});
const portrait = formatOf({
  fps: 30,
  width: 1080,
  height: 1920,
  durationInFrames: 1,
});
const uhd = formatOf({fps: 24, width: 3840, height: 2160, durationInFrames: 1});

describe('formatOf', () => {
  it('scales reference px by the short side', () => {
    assert.equal(landscape.unit, 1);
    assert.equal(portrait.unit, 1);
    assert.equal(uhd.unit, 2);
  });

  it('insets the title-safe box by the margin on every side', () => {
    assert.deepEqual(landscape.safe, {x: 96, y: 96, width: 1728, height: 888});
    assert.deepEqual(portrait.safe, {x: 96, y: 96, width: 888, height: 1728});
    assert.equal(uhd.safe.x, 2 * SAFE_MARGIN);
    assert.equal(portrait.safeWidth, portrait.safe.width);
  });

  it('converts frames and seconds at the given rate', () => {
    assert.equal(toSec(90, 30), 3);
    assert.equal(toFrames(1.5, 24), 36);
  });
});

describe('layoutOf', () => {
  it('keeps the landscape tokens as they are', () => {
    const l = layoutOf(landscape);
    assert.equal(l.slateX, space.slateX);
    assert.equal(l.slateY, space.slateY);
    assert.equal(l.headlineMaxWidth, space.headlineMaxWidth);
    assert.equal(l.captionMaxWidth, space.captionMaxWidth);
  });

  it('fits a portrait frame inside its safe box', () => {
    const l = layoutOf(portrait);
    const right = portrait.safe.x + portrait.safe.width;
    assert.equal(l.slateX, space.slateX);
    assert.equal(l.headlineMaxWidth, right - l.slateX);
    assert.ok(l.slateX + l.headlineMaxWidth <= right);
    assert.ok(l.slateX + l.captionMaxWidth <= right);
  });

  it('scales with the frame', () => {
    const l = layoutOf(uhd);
    assert.equal(l.slateX, 2 * space.slateX);
    assert.equal(l.headlineMaxWidth, 2 * space.headlineMaxWidth);
  });
});
