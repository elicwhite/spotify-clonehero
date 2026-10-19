declare module 'hypher' {
  interface HyphenationPatterns {
    leftmin: number;
    rightmin: number;
    patterns: Record<string, unknown>;
  }
  class Hypher {
    constructor(patterns: HyphenationPatterns);
    hyphenate(word: string): string[];
    hyphenateText(text: string, minLength?: number): string;
  }
  export default Hypher;
}

declare module 'hyphenation.en-us' {
  const patterns: import('hypher').HyphenationPatterns;
  export default patterns;
}
