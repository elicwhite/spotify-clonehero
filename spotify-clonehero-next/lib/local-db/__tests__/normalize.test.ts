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
