/**
 * Lyrics-row editing commands (plan 0063 Round 2 §2): AddLyricCommand,
 * DeleteLyricCommand, SetLyricTextCommand, AddPhraseCommand,
 * DeletePhraseCommand.
 */

import {
  AddLyricCommand,
  DeleteLyricCommand,
  SetLyricTextCommand,
  AddPhraseCommand,
  DeletePhraseCommand,
} from '../commands';
import {expectDocsEqual, makeFixtureDoc} from './fixtures';

// makeFixtureDoc: vocals phrase 0..960 with lyrics at 240 + 720.

describe('AddLyricCommand', () => {
  it('adds a syllable inside the existing phrase', () => {
    const before = makeFixtureDoc();
    const cmd = new AddLyricCommand(480, 'mid');
    const after = cmd.execute(before);

    const phrase = after.parsedChart.vocalTracks.parts['vocals'].notePhrases[0];
    expect(phrase.lyrics.map(l => l.tick)).toEqual([240, 480, 720]);
    expect(phrase.lyrics.find(l => l.tick === 480)?.text).toBe('mid');
  });

  it('execute leaves the input doc untouched (valid undo snapshot)', () => {
    const pristine = makeFixtureDoc();
    const before = makeFixtureDoc();
    const cmd = new AddLyricCommand(480, 'mid');
    const after = cmd.execute(before);

    expect(after).not.toBe(before);
    expectDocsEqual(before, pristine);
  });

  it('is a no-op outside any phrase', () => {
    const before = makeFixtureDoc();
    const cmd = new AddLyricCommand(5000, 'nope');
    const after = cmd.execute(before);

    expect(after).toBe(before);
  });
});

describe('DeleteLyricCommand', () => {
  it('removes the lyric at tick', () => {
    const before = makeFixtureDoc();
    const cmd = new DeleteLyricCommand(240);
    const after = cmd.execute(before);

    const phrase = after.parsedChart.vocalTracks.parts['vocals'].notePhrases[0];
    expect(phrase.lyrics.map(l => l.tick)).toEqual([720]);
  });

  it('execute leaves the input doc untouched (valid undo snapshot)', () => {
    const pristine = makeFixtureDoc();
    const before = makeFixtureDoc();
    const cmd = new DeleteLyricCommand(240);
    const after = cmd.execute(before);

    expect(after).not.toBe(before);
    expectDocsEqual(before, pristine);
  });

  it('deletes the phrase too when its last lyric is removed, each step leaving its input untouched', () => {
    const before = makeFixtureDoc();
    const pristineBefore = makeFixtureDoc();
    const del1 = new DeleteLyricCommand(240);
    const afterDel1 = del1.execute(before);
    expectDocsEqual(before, pristineBefore);

    const pristineAfterDel1 = del1.execute(makeFixtureDoc());
    const del2 = new DeleteLyricCommand(720);
    const afterDel2 = del2.execute(afterDel1);

    expect(
      afterDel2.parsedChart.vocalTracks.parts['vocals'].notePhrases,
    ).toHaveLength(0);
    expectDocsEqual(afterDel1, pristineAfterDel1);
  });

  it('is a no-op when no lyric exists at tick', () => {
    const before = makeFixtureDoc();
    const cmd = new DeleteLyricCommand(1);
    const after = cmd.execute(before);
    expect(after).toBe(before);
  });
});

describe('SetLyricTextCommand', () => {
  it('replaces the lyric text', () => {
    const before = makeFixtureDoc();
    const cmd = new SetLyricTextCommand(240, 'changed');
    const after = cmd.execute(before);

    const phrase = after.parsedChart.vocalTracks.parts['vocals'].notePhrases[0];
    expect(phrase.lyrics.find(l => l.tick === 240)?.text).toBe('changed');
  });

  it('execute leaves the input doc untouched (valid undo snapshot)', () => {
    const pristine = makeFixtureDoc();
    const before = makeFixtureDoc();
    const cmd = new SetLyricTextCommand(240, 'changed');
    const after = cmd.execute(before);

    expect(after).not.toBe(before);
    expectDocsEqual(before, pristine);
  });

  it('is a no-op when no lyric exists at tick', () => {
    const before = makeFixtureDoc();
    const cmd = new SetLyricTextCommand(1, 'x');
    const after = cmd.execute(before);
    expect(after).toBe(before);
  });
});

describe('AddPhraseCommand', () => {
  it('creates an empty phrase in open space', () => {
    const before = makeFixtureDoc();
    const cmd = new AddPhraseCommand(2000);
    const after = cmd.execute(before);

    const phrases = after.parsedChart.vocalTracks.parts['vocals'].notePhrases;
    expect(phrases).toHaveLength(2);
    expect(phrases[1]).toMatchObject({tick: 2000, lyrics: [], notes: []});
  });

  it('execute leaves the input doc untouched (valid undo snapshot)', () => {
    const pristine = makeFixtureDoc();
    const before = makeFixtureDoc();
    const cmd = new AddPhraseCommand(2000);
    const after = cmd.execute(before);

    expect(after).not.toBe(before);
    expectDocsEqual(before, pristine);
  });

  it('is a no-op when the tick is already inside a phrase', () => {
    const before = makeFixtureDoc();
    const cmd = new AddPhraseCommand(480);
    const after = cmd.execute(before);
    expect(after).toBe(before);
  });
});

describe('DeletePhraseCommand', () => {
  it('removes the phrase and its lyrics', () => {
    const before = makeFixtureDoc();
    const cmd = new DeletePhraseCommand(0);
    const after = cmd.execute(before);

    expect(
      after.parsedChart.vocalTracks.parts['vocals'].notePhrases,
    ).toHaveLength(0);
  });

  it('execute leaves the input doc untouched (valid undo snapshot)', () => {
    const pristine = makeFixtureDoc();
    const before = makeFixtureDoc();
    const cmd = new DeletePhraseCommand(0);
    const after = cmd.execute(before);

    expect(after).not.toBe(before);
    expectDocsEqual(before, pristine);
  });

  it('is a no-op when no phrase starts at tick', () => {
    const before = makeFixtureDoc();
    const cmd = new DeletePhraseCommand(1);
    const after = cmd.execute(before);
    expect(after).toBe(before);
  });
});
