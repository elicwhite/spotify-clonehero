import {
  buildWaveformSources,
  defaultWaveformSourceId,
  labelForSource,
} from '../waveformSources';

describe('labelForSource', () => {
  it('maps known stem names to friendly labels', () => {
    expect(labelForSource('drums')).toBe('Drums');
    expect(labelForSource('song')).toBe('Song (full mix)');
    expect(labelForSource('bass')).toBe('Bass');
  });

  it('title-cases unknown ids', () => {
    expect(labelForSource('guitar')).toBe('Guitar');
  });
});

describe('buildWaveformSources', () => {
  it('lists every track and puts the drum stem first', () => {
    const sources = buildWaveformSources(['song', 'drums']);
    expect(sources.map(s => s.id)).toEqual(['drums', 'song']);
    expect(sources.map(s => s.label)).toEqual(['Drums', 'Song (full mix)']);
  });

  it('preserves order among non-drum sources', () => {
    const sources = buildWaveformSources(['song', 'bass', 'other']);
    expect(sources.map(s => s.id)).toEqual(['song', 'bass', 'other']);
  });

  it('handles an empty manager', () => {
    expect(buildWaveformSources([])).toEqual([]);
  });
});

describe('defaultWaveformSourceId', () => {
  it('prefers the drum stem', () => {
    expect(defaultWaveformSourceId(buildWaveformSources(['song', 'drums']))).toBe(
      'drums',
    );
  });

  it('falls back to the full mix when there is no drum stem', () => {
    expect(defaultWaveformSourceId(buildWaveformSources(['song', 'bass']))).toBe(
      'song',
    );
  });

  it('falls back to the first source when neither is present', () => {
    expect(defaultWaveformSourceId(buildWaveformSources(['bass', 'other']))).toBe(
      'bass',
    );
  });

  it('returns null with no sources', () => {
    expect(defaultWaveformSourceId([])).toBeNull();
  });
});
