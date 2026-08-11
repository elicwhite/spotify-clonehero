import {normalizeStrForMatching} from '../normalize';

describe('normalizeStrForMatching', () => {
  it('should remove contents of parens', () => {
    expect(normalizeStrForMatching('Hello (World)')).toBe('hello');
    expect(normalizeStrForMatching('(Rebirth) Freedom Dive (Live)')).toBe(
      'freedom dive',
    );
  });

  it('should remove contents of brackets', () => {
    expect(normalizeStrForMatching('Hello [World]')).toBe('hello');
    expect(normalizeStrForMatching('[&] Delinquents [Reincarnation]')).toBe(
      'delinquents',
    );
    expect(normalizeStrForMatching('[]DENTITY')).toBe('dentity');
  });

  it('should remove all non-alphanumeric characters', () => {
    expect(normalizeStrForMatching('Hello, World!')).toBe('hello world');
    expect(normalizeStrForMatching('*NSYNC')).toBe('nsync');
    expect(normalizeStrForMatching('P.O.D.')).toBe('pod');
  });

  it('should strip leading articles', () => {
    expect(normalizeStrForMatching('The Feel Good Drag')).toBe(
      'feel good drag',
    );
    expect(normalizeStrForMatching('A Day to Remember')).toBe(
      'day to remember',
    );
    expect(normalizeStrForMatching('An Ending')).toBe('ending');
    // Should not strip articles in the middle
    expect(normalizeStrForMatching('End of the World')).toBe(
      'end of the world',
    );
    // Should not strip if it's the entire string
    expect(normalizeStrForMatching('The')).toBe('the');
  });

  it('should strip hyphenated edition suffixes', () => {
    expect(normalizeStrForMatching('Comfortably Numb - Remastered 2011')).toBe(
      'comfortably numb',
    );
    expect(normalizeStrForMatching('Comfortably Numb')).toBe(
      'comfortably numb',
    );
    expect(normalizeStrForMatching('Bohemian Rhapsody - 2011 Mix')).toBe(
      'bohemian rhapsody',
    );
    expect(normalizeStrForMatching('Runaway - Live at Wembley')).toBe(
      'runaway',
    );
    expect(normalizeStrForMatching('Feel Good Inc - Radio Edit')).toBe(
      'feel good inc',
    );
  });

  it('should keep hyphenated titles that are not edition labels', () => {
    expect(normalizeStrForMatching('Karn Evil 9 - Part Two')).toBe(
      'karn evil 9 part two',
    );
    expect(normalizeStrForMatching('Marquee Moon - Alright')).toBe(
      'marquee moon alright',
    );
    // A song actually titled "Live" keeps its title, losing only the edition
    expect(normalizeStrForMatching('Live - Live')).toBe('live');
    // Never strip away everything
    expect(normalizeStrForMatching(' - Remastered')).toBe('remastered');
  });

  it('should treat "&" and "+" as "and"', () => {
    expect(normalizeStrForMatching('Rock & Roll')).toBe(
      normalizeStrForMatching('Rock and Roll'),
    );
    expect(normalizeStrForMatching('Simon & Garfunkel')).toBe(
      'simon and garfunkel',
    );
    expect(normalizeStrForMatching('Florence + The Machine')).toBe(
      'florence and the machine',
    );
    // The conjunction must not glue words together
    expect(normalizeStrForMatching('Sam&Dave')).toBe('sam and dave');
  });

  it('should drop featured-artist suffixes', () => {
    expect(normalizeStrForMatching('Numb feat. JAY-Z')).toBe('numb');
    expect(normalizeStrForMatching('Numb ft JAY-Z')).toBe('numb');
    expect(normalizeStrForMatching('Eminem featuring Dido')).toBe('eminem');
    // "feat" as a word of the title itself is left alone
    expect(normalizeStrForMatching('Feat of Strength')).toBe(
      'feat of strength',
    );
  });

  it('should preserve non-Latin scripts while folding Latin diacritics', () => {
    // Cyrillic should be preserved (only lowercased)
    expect(normalizeStrForMatching('Дурной Вкус')).toBe('дурной вкус');
    expect(normalizeStrForMatching('Светомузыка')).toBe('светомузыка');

    // Latin with diacritics should be folded
    expect(normalizeStrForMatching('Beyoncé')).toBe('beyonce');
    expect(normalizeStrForMatching('Mélissa')).toBe('melissa');
    expect(normalizeStrForMatching('Noël')).toBe('noel');
    expect(normalizeStrForMatching('Inyección')).toBe('inyeccion');
  });
});
