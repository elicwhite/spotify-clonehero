/**
 * A chart that arrives with its silence already in the audio (plan 0124 §2).
 *
 * Export bakes the pad into the audio files, so a chart of ours that is
 * opened again has the lead-in in its ticks and the silence in its recording,
 * with an anchor of zero. Removing a bar there has to take the audio with it,
 * which means the pad goes NEGATIVE and the export trims.
 *
 * The first draft of this design could not do that: the anchor clamped at
 * zero, so `planExportAudio` returned `raw` and the export shipped
 * still-padded audio beside a chart shifted a bar earlier — misaligned by a
 * whole bar, with no error.
 */

import {AddLeadingSilenceCommand} from '../commands';
import {planExportAudio} from '../hooks/projectAudio';
import {
  applyDocSidecars,
  getAudioAnchor,
  getSongStartTick,
  leadInBars,
  planLeadIn,
  setAudioAnchor,
  type ChartDocument,
} from '@/lib/chart-edit';
import {makeFixtureDoc} from './fixtures';

const SAMPLE_RATE = 48000;

/** All `planExportAudio` needs: the rate to quantize the anchor with. */
const PACKAGE = {sampleRate: SAMPLE_RATE};

/** Pad a fresh chart by two bars, the way the card does. */
function padded(): ChartDocument {
  const doc = applyDocSidecars(makeFixtureDoc(), {songStartTick: 0});
  return new AddLeadingSilenceCommand(planLeadIn(doc, 2)!).execute(doc);
}

/** The same chart after an export and a fresh import: the silence is in the
 *  recording now, so the chart is anchored at zero against it. */
function reimported(): ChartDocument {
  return setAudioAnchor(padded(), null);
}

describe('a chart whose audio already carries the lead-in', () => {
  it('still reads two bars of lead-in with no anchor at all', () => {
    const doc = reimported();
    expect(getAudioAnchor(doc)).toBeNull();
    expect(leadInBars(doc)).toBeCloseTo(2, 6);
    expect(getSongStartTick(doc)).toBeGreaterThan(0);
  });

  it('removes a bar by trimming the audio, not by pretending it cannot', () => {
    const doc = reimported();
    const plan = planLeadIn(doc, 1)!;
    expect(plan.bars).toBe(1);
    expect(plan.padMs).toBeLessThan(0);

    const after = new AddLeadingSilenceCommand(plan).execute(doc);
    expect(getAudioAnchor(after)!.ms).toBeLessThan(0);
    expect(leadInBars(after)).toBeCloseTo(1, 6);
  });

  it('exports the trim, rather than shipping the audio unchanged', () => {
    const after = new AddLeadingSilenceCommand(
      planLeadIn(reimported(), 1)!,
    ).execute(reimported());
    const exportPlan = planExportAudio(PACKAGE, getAudioAnchor(after));
    expect(exportPlan.kind).toBe('shifted');
    expect(
      exportPlan.kind === 'shifted' ? exportPlan.shiftSamples : 0,
    ).toBeLessThan(0);
  });

  it('refuses to export a trim it cannot perform, instead of shipping raw', () => {
    const after = new AddLeadingSilenceCommand(
      planLeadIn(reimported(), 1)!,
    ).execute(reimported());
    expect(planExportAudio(null, getAudioAnchor(after))).toEqual({
      kind: 'blocked',
    });
  });

  it('refuses a removal that would push a NON-note event past tick 0', () => {
    // The bound that stops this used to scan `noteEventGroups` alone, while
    // the shift moved twenty-odd arrays. Harmless while the pad could not go
    // negative; with a signed anchor the section would be shifted past tick
    // 0, clamped there by `reTickEvent`, and silently collapsed onto the
    // same tick as everything else that went with it.
    expect(planLeadIn(reimported(), 1)).not.toBeNull(); // baseline: allowed

    const doc = reimported();
    // A section 200 ms in — inside the bar about to be removed, and not a
    // note, so only the shared traversal can see it.
    doc.parsedChart.sections.push({
      tick: 0,
      msTime: 200,
      msLength: 0,
      name: 'Intro',
    } as (typeof doc.parsedChart.sections)[number]);

    expect(planLeadIn(doc, 1)).toBeNull();
  });

  it('adds a bar the ordinary way from the same state', () => {
    const doc = reimported();
    const after = new AddLeadingSilenceCommand(planLeadIn(doc, 3)!).execute(
      doc,
    );
    expect(getAudioAnchor(after)!.ms).toBeGreaterThan(0);
    expect(leadInBars(after)).toBeCloseTo(3, 6);
  });
});
