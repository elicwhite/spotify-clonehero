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
});
