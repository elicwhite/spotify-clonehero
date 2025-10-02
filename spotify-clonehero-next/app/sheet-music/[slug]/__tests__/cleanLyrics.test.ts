import cleanLyrics from '../cleanLyrics';

describe('cleanLyrics', () => {
  it('should return empty string for empty input', () => {
    expect(cleanLyrics('')).toEqual('');
  });

  it('should return null/undefined for null/undefined input', () => {
    expect(cleanLyrics(null as any)).toEqual(null);
    expect(cleanLyrics(undefined as any)).toEqual(undefined);
  });

  it('should strip pitch slide symbols (+)', () => {
    expect(cleanLyrics('Hello+world')).toEqual('Helloworld');
    expect(cleanLyrics('Test+lyrics+here')).toEqual('Testlyricshere');
  });

  it('should strip non-pitched symbols (#)', () => {
    expect(cleanLyrics('Hello#world')).toEqual('Helloworld');
    expect(cleanLyrics('Test#lyrics#here')).toEqual('Testlyricshere');
  });

  it('should strip non-pitched lenient symbols (^)', () => {
    expect(cleanLyrics('Hello^world')).toEqual('Helloworld');
    expect(cleanLyrics('Test^lyrics^here')).toEqual('Testlyricshere');
  });

  it('should strip non-pitched unknown symbols (*)', () => {
    expect(cleanLyrics('Hello*world')).toEqual('Helloworld');
    expect(cleanLyrics('Test*lyrics*here')).toEqual('Testlyricshere');
  });

  it('should strip range shift symbols (%)', () => {
    expect(cleanLyrics('Hello%world')).toEqual('Helloworld');
    expect(cleanLyrics('Test%lyrics%here')).toEqual('Testlyricshere');
  });

  it('should strip static shift symbols (/)', () => {
    expect(cleanLyrics('Hello/world')).toEqual('Helloworld');
    expect(cleanLyrics('Test/lyrics/here')).toEqual('Testlyricshere');
  });

  it('should strip harmony hide symbols ($)', () => {
    expect(cleanLyrics('Hello$world')).toEqual('Helloworld');
    expect(cleanLyrics('Test$lyrics$here')).toEqual('Testlyricshere');
  });

  it('should strip quotation marks (")', () => {
    expect(cleanLyrics('Hello"world')).toEqual('Helloworld');
    expect(cleanLyrics('Test"lyrics"here')).toEqual('Testlyricshere');
  });

  it('should replace hyphen join symbols (=) with hyphens (-)', () => {
    expect(cleanLyrics('Hello=world')).toEqual('Hello-world');
    expect(cleanLyrics('Test=lyrics=here')).toEqual('Test-lyrics-here');
  });

  it('should replace joined syllable symbols (§) with tie characters (‿)', () => {
    expect(cleanLyrics('Hello§world')).toEqual('Hello‿world');
    expect(cleanLyrics('Test§lyrics§here')).toEqual('Test‿lyrics‿here');
  });

  it('should replace space escape symbols (_) with spaces', () => {
    expect(cleanLyrics('Hello_world')).toEqual('Hello world');
    expect(cleanLyrics('Test_lyrics_here')).toEqual('Test lyrics here');
  });

  it('should handle multiple symbol types in one string', () => {
    expect(cleanLyrics('Hello+world=test#lyrics^here')).toEqual(
      'Helloworld-testlyricshere',
    );
    expect(cleanLyrics('Test%lyrics/here$now')).toEqual('Testlyricsherenow');
  });

  it('should handle symbols at the beginning and end', () => {
    expect(cleanLyrics('+Hello world+')).toEqual('Hello world');
    expect(cleanLyrics('#Test lyrics#')).toEqual('Test lyrics');
    expect(cleanLyrics('=Hello world=')).toEqual('-Hello world-');
  });

  it('should handle only symbols', () => {
    expect(cleanLyrics('+')).toEqual('');
    expect(cleanLyrics('#^%/$')).toEqual('');
    expect(cleanLyrics('=')).toEqual('-');
    expect(cleanLyrics('§')).toEqual('‿');
    expect(cleanLyrics('_')).toEqual(' ');
  });

  it('should handle rich text tags by using removeStyleTags', () => {
    expect(cleanLyrics('<color=#AEFFFF>Hello</color> world')).toEqual(
      'Hello world',
    );
    expect(cleanLyrics('<b>Bold</b> text')).toEqual('Bold text');
    expect(cleanLyrics('<i>Italic</i> <u>underlined</u>')).toEqual(
      'Italic underlined',
    );
  });

  it('should handle rich text tags with symbols', () => {
    expect(cleanLyrics('<color=#AEFFFF>Hello+world</color>')).toEqual(
      'Helloworld',
    );
    expect(cleanLyrics('<b>Test=lyrics</b>')).toEqual('Test-lyrics');
    expect(cleanLyrics('<i>Hello§world</i>')).toEqual('Hello‿world');
  });

  it('should handle complex real-world examples', () => {
    // Example with various symbols and rich text
    expect(
      cleanLyrics('<color=#FF0000>Hello+world=test#lyrics^here</color>'),
    ).toEqual('Helloworld-testlyricshere');

    // Example with multiple replacements
    expect(cleanLyrics('Verse_1=chorus§bridge')).toEqual(
      'Verse 1-chorus‿bridge',
    );

    // Example with all symbol types
    expect(
      cleanLyrics('+Test#lyrics^with*all%symbols/$and="replacements§_here"'),
    ).toEqual('Testlyricswithallsymbolsand-replacements‿ here');
  });

  it('should handle edge cases with special regex characters', () => {
    // Test that special regex characters in symbols are properly escaped
    expect(cleanLyrics('Test+lyrics')).toEqual('Testlyrics');
    expect(cleanLyrics('Test*lyrics')).toEqual('Testlyrics');
    expect(cleanLyrics('Test^lyrics')).toEqual('Testlyrics');
  });
});
