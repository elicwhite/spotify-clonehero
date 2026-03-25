import {parseLyrics} from '../parse-lyrics';

function makeLyric(msTime: number, text: string) {
  return {msTime, msLength: 0, text};
}

describe('parseLyrics', () => {
  describe('auto-ending phrases', () => {
    it('clamps a phrase that overlaps the next phrase start', () => {
      const rawLyrics = [
        makeLyric(1000, 'Hello'),
        makeLyric(1200, 'world'),
        makeLyric(3000, 'Goodbye'),
        makeLyric(3200, 'moon'),
      ];

      // First phrase has msLength extending well past the second phrase start
      const vocalPhrases = [
        {msTime: 900, msLength: 5000}, // would extend to 5900, but phrase 2 starts at 2900
        {msTime: 2900, msLength: 1000},
      ];

      const lines = parseLyrics(rawLyrics, vocalPhrases);

      expect(lines).toHaveLength(2);
      expect(lines[0].text).toBe('Hello world');
      expect(lines[1].text).toBe('Goodbye moon');
    });

    it('does not clamp phrases that do not overlap', () => {
      const rawLyrics = [
        makeLyric(1000, 'Hello'),
        makeLyric(3000, 'World'),
      ];

      const vocalPhrases = [
        {msTime: 900, msLength: 500},
        {msTime: 2900, msLength: 500},
      ];

      const lines = parseLyrics(rawLyrics, vocalPhrases);

      expect(lines).toHaveLength(2);
      expect(lines[0].text).toBe('Hello');
      expect(lines[1].text).toBe('World');
    });

    it('handles phrase with no explicit end (very long msLength) before next phrase', () => {
      const rawLyrics = [
        makeLyric(100, 'A'),
        makeLyric(500, 'B'),
        makeLyric(2000, 'C'),
      ];

      // First phrase has an absurdly long length (no explicit end marker),
      // second phrase starts at 1500 — should auto-end the first phrase
      const vocalPhrases = [
        {msTime: 0, msLength: 999999},
        {msTime: 1500, msLength: 1000},
      ];

      const lines = parseLyrics(rawLyrics, vocalPhrases);

      expect(lines).toHaveLength(2);
      expect(lines[0].text).toBe('A B');
      expect(lines[1].text).toBe('C');
    });
  });
});
