import {mapAndMerge} from '../linkseg-run';

// mapAndMerge: 7-class raw labels -> product names + merge consecutive identically-labeled
// segments (benign tau=0 over-segmentation). Returns S+1 times / S labels.
describe('mapAndMerge', () => {
  it('maps 7-class labels to product names', () => {
    const out = mapAndMerge({times: [0, 5, 10], labels: ['verse', 'chorus']});
    expect(out.labels).toEqual(['Verse', 'Chorus']);
    expect(out.times).toEqual([0, 5, 10]);
  });

  it('merges consecutive duplicate segments by extending the previous edge', () => {
    const out = mapAndMerge({
      times: [0, 4, 8, 12, 16],
      labels: ['verse', 'verse', 'chorus', 'verse'],
    });
    expect(out.labels).toEqual(['Verse', 'Chorus', 'Verse']);
    // first Verse spans [0,8) after merging the two consecutive verses
    expect(out.times).toEqual([0, 8, 12, 16]);
  });

  it('passes non-adjacent repeats through unmerged', () => {
    const out = mapAndMerge({
      times: [0, 4, 8, 12],
      labels: ['intro', 'verse', 'intro'],
    });
    expect(out.labels).toEqual(['Intro', 'Verse', 'Intro']);
    expect(out.times).toEqual([0, 4, 8, 12]);
  });

  it('relabels leading silence as Intro', () => {
    const out = mapAndMerge({
      times: [0, 4, 8, 12],
      labels: ['silence', 'verse', 'chorus'],
    });
    expect(out.labels).toEqual(['Intro', 'Verse', 'Chorus']);
    expect(out.times).toEqual([0, 4, 8, 12]);
  });

  it('merges mid-song silence into the preceding segment', () => {
    const out = mapAndMerge({
      times: [0, 4, 8, 12, 16],
      labels: ['verse', 'silence', 'chorus', 'verse'],
    });
    expect(out.labels).toEqual(['Verse', 'Chorus', 'Verse']);
    // the silence's span [4,8) is absorbed into the preceding Verse, extending it to 8
    expect(out.times).toEqual([0, 8, 12, 16]);
  });

  it('merges trailing silence into the preceding segment', () => {
    const out = mapAndMerge({
      times: [0, 4, 8, 12],
      labels: ['verse', 'chorus', 'silence'],
    });
    expect(out.labels).toEqual(['Verse', 'Chorus']);
    expect(out.times).toEqual([0, 4, 12]);
  });

  it('collapses an all-silence song to a single Intro', () => {
    const out = mapAndMerge({
      times: [0, 20],
      labels: ['silence'],
    });
    expect(out.labels).toEqual(['Intro']);
    expect(out.times).toEqual([0, 20]);
  });

  it('merges leading silence-as-Intro with a following real Intro', () => {
    const out = mapAndMerge({
      times: [0, 4, 8, 12],
      labels: ['silence', 'intro', 'verse'],
    });
    expect(out.labels).toEqual(['Intro', 'Verse']);
    expect(out.times).toEqual([0, 8, 12]);
  });

  it('never emits the raw label "silence" as a product name', () => {
    const out = mapAndMerge({
      times: [0, 4, 8, 12, 16],
      labels: ['silence', 'verse', 'silence', 'silence'],
    });
    expect(out.labels).not.toContain('silence');
    expect(out.labels).not.toContain('Silence');
  });
});
