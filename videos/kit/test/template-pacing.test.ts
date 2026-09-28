import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {auditPacing} from '../scripts/qa/pacing';
import {pacing} from '../template/src/pacing';

describe("the film template's pacing sheet", () => {
  it('passes the pacing audit', () => {
    const {failures} = auditPacing(pacing);
    assert.deepEqual(failures, []);
  });

  it('times every line of copy the scenes draw', () => {
    assert.deepEqual(
      auditPacing(pacing).rows.map(r => r.id),
      ['title-headline', 'title-caption', 'end-title', 'end-url'],
    );
  });
});
