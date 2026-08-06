import {createEmptyChart, scanIni} from '@eliwhite/scan-chart';
import type {ChartDocument} from '@/lib/chart-edit';
import {getAssistProvenance, withAssistProvenance} from '../content-stamps';
import {
  applySongIniMetadata,
  defaultIniMetadata,
  readSongIniMetadata,
  stripDefaultIniMetadata,
  withSongIniFields,
  type SongIniMetadataValue,
} from '../songIniMetadata';

function doc(): ChartDocument {
  return {
    parsedChart: createEmptyChart({bpm: 120, resolution: 192}),
    assets: [],
  };
}

const VALUE: SongIniMetadataValue = {
  name: 'Song',
  artist: 'Artist',
  charter: 'Charter',
  album: 'Album',
  genre: 'Rock',
  year: '2004',
  difficulties: {diff_drums: 4, diff_drums_real: 4, diff_guitar: null},
  drumDifficultyStamp: 'stamp-a',
};

describe('applySongIniMetadata', () => {
  it('writes every field the dialog collected, not just identity', () => {
    const {metadata} = applySongIniMetadata(doc(), VALUE).parsedChart;

    expect(metadata.name).toBe('Song');
    expect(metadata.artist).toBe('Artist');
    expect(metadata.charter).toBe('Charter');
    expect(metadata.album).toBe('Album');
    expect(metadata.genre).toBe('Rock');
    expect(metadata.year).toBe('2004');
    expect(metadata.diff_drums).toBe(4);
    expect(metadata.diff_drums_real).toBe(4);
  });

  it("writes song.ini's -1 sentinel for a difficulty the user unset", () => {
    const {metadata} = applySongIniMetadata(doc(), VALUE).parsedChart;
    expect(metadata.diff_guitar).toBe(-1);
  });

  it('records the drum stamp as assist provenance, beside the other staleness sources', () => {
    const applied = applySongIniMetadata(
      withAssistProvenance(doc(), {acks: {sections: {ackStamp: 'ack'}}}),
      VALUE,
    );

    const provenance = getAssistProvenance(applied);
    expect(provenance?.songIniDrumDifficulty).toEqual({sourceStamp: 'stamp-a'});
    // Unrelated provenance is preserved, not replaced wholesale.
    expect(provenance?.acks?.sections).toEqual({ackStamp: 'ack'});
  });

  it('leaves the document unmutated', () => {
    const original = doc();
    applySongIniMetadata(original, VALUE);
    expect(original.parsedChart.metadata.album).not.toBe('Album');
  });
});

describe('readSongIniMetadata', () => {
  it('round-trips everything applySongIniMetadata wrote', () => {
    const applied = applySongIniMetadata(doc(), VALUE);

    const read = readSongIniMetadata(applied, {
      name: VALUE.name,
      artist: VALUE.artist,
      charter: VALUE.charter,
    });

    expect(read.album).toBe('Album');
    expect(read.genre).toBe('Rock');
    expect(read.year).toBe('2004');
    expect(read.difficulties.diff_drums).toBe(4);
    // The -1 sentinel reads back as the form's "not set".
    expect(read.difficulties.diff_guitar).toBeNull();
    expect(read.drumDifficultyStamp).toBe('stamp-a');
  });

  it('takes identity from the host, which owns the project record', () => {
    const applied = applySongIniMetadata(doc(), VALUE);

    const read = readSongIniMetadata(applied, {
      name: 'Renamed',
      artist: '',
      charter: '',
    });

    expect(read.name).toBe('Renamed');
    expect(read.artist).toBe('');
  });

  it('reads blanks and no stamp when no chart is loaded', () => {
    const read = readSongIniMetadata(null, {
      name: 'Untitled',
      artist: '',
      charter: '',
    });

    expect(read.album).toBe('');
    expect(read.year).toBe('');
    expect(read.drumDifficultyStamp).toBeUndefined();
    expect(read.difficulties.diff_drums).toBeNull();
  });
});

/**
 * The fields a `.chart` file cannot carry, spelled the way `song.ini` spells
 * them. A chart that declares a bass intensity says `diff_bass`; the
 * `diff_bass_real` beside it in Rock Band-derived charts is a Pro Bass field
 * this project neither reads nor writes, and rides through as an unknown key.
 */
const SOURCE_INI = [
  '[song]',
  'name = Placeholder Title',
  'artist = Placeholder Artist',
  'charter = Placeholder Charter',
  'diff_guitar = 3',
  'diff_bass = 2',
  'diff_drums = 2',
  'diff_drums_real = 2',
  'diff_keys = -1',
  'icon = someicon',
  'diff_bass_real = 2',
  '',
].join('\n');

function iniFile(text = SOURCE_INI) {
  return {fileName: 'song.ini', data: new TextEncoder().encode(text)};
}

describe('withSongIniFields', () => {
  it('overlays the intensities a .chart file has nowhere to carry', () => {
    const {metadata} = withSongIniFields(doc(), iniFile()).parsedChart;

    expect(metadata.diff_guitar).toBe(3);
    expect(metadata.diff_bass).toBe(2);
    expect(metadata.diff_drums).toBe(2);
    expect(metadata.diff_drums_real).toBe(2);
  });

  it('surfaces a declared bass intensity to the dialog, not "not set"', () => {
    const merged = withSongIniFields(doc(), iniFile());

    const read = readSongIniMetadata(merged, {
      name: 'Placeholder Title',
      artist: '',
      charter: '',
    });

    expect(read.difficulties.diff_bass).toBe(2);
    expect(read.difficulties.diff_guitar).toBe(3);
    expect(read.difficulties.diff_drums_real).toBe(2);
    // -1 is the ini's own "not set", and reads back as the form's null.
    expect(read.difficulties.diff_keys).toBeNull();
  });

  it('carries the fields the editor never edits, known and custom alike', () => {
    const {metadata} = withSongIniFields(doc(), iniFile()).parsedChart;

    expect(metadata.icon).toBe('someicon');
    expect(metadata.extraIniFields).toEqual({diff_bass_real: '2'});
  });

  it('drops the placeholders scan-chart fills in for absent keys', () => {
    // `scanIni` returns a fully populated object, so this ini — which names
    // no album, no genre and no year — parses with "Unknown Album" and
    // friends in it. None of them may reach the document, or the second load
    // of a project would overwrite the chart file's real values with them.
    const {metadata} = withSongIniFields(doc(), iniFile()).parsedChart;

    expect(metadata.album).toBeUndefined();
    expect(metadata.genre).toBeUndefined();
    expect(metadata.year).toBeUndefined();
    expect(metadata.song_length).toBeUndefined();
    expect(metadata.loading_phrase).toBeUndefined();
  });

  it('lets the chart file win on the fields it can express', () => {
    const chartDoc = doc();
    chartDoc.parsedChart.metadata = {
      name: 'Chart Name',
      artist: 'Chart Artist',
      album: 'Chart Album',
    };

    const {metadata} = withSongIniFields(chartDoc, iniFile()).parsedChart;

    // The ini names all three, and loses all three: both files were written
    // from one document, so a disagreement means the ini is the stale one.
    expect(metadata.name).toBe('Chart Name');
    expect(metadata.artist).toBe('Chart Artist');
    expect(metadata.album).toBe('Chart Album');
    // The fields the chart cannot express still come from the ini.
    expect(metadata.diff_drums).toBe(2);
    expect(metadata.icon).toBe('someicon');
  });

  it('leaves the document alone when the bytes are not a song.ini', () => {
    const original = doc();
    const merged = withSongIniFields(original, iniFile('not an ini at all'));
    expect(merged.parsedChart.metadata).toEqual(original.parsedChart.metadata);
  });

  it('does not mutate the document it was given', () => {
    const original = doc();
    withSongIniFields(original, iniFile());
    expect(original.parsedChart.metadata.diff_bass).not.toBe(2);
  });
});

describe('stripDefaultIniMetadata', () => {
  it('reduces an ini that names nothing to nothing at all', () => {
    const parsed = scanIni([iniFile('[song]\nunknown_key = 1\n')]);
    expect(parsed.metadata).not.toBeNull();

    expect(stripDefaultIniMetadata(parsed.metadata!)).toEqual({});
  });

  it("keeps every value that is not scan-chart's default", () => {
    const parsed = scanIni([iniFile()]);

    expect(stripDefaultIniMetadata(parsed.metadata!)).toEqual({
      name: 'Placeholder Title',
      artist: 'Placeholder Artist',
      charter: 'Placeholder Charter',
      icon: 'someicon',
      diff_guitar: 3,
      diff_bass: 2,
      diff_drums: 2,
      diff_drums_real: 2,
    });
  });
});

describe('defaultIniMetadata', () => {
  it('covers every key scan-chart parses out of a song.ini', () => {
    const defaults = defaultIniMetadata();
    const parsed = scanIni([iniFile()]);

    // Asserted by construction rather than against a transcribed table, so a
    // fork bump that adds a field or changes a default cannot leave this
    // passing while the strip goes blind to it.
    expect(Object.keys(defaults).sort()).toEqual(
      Object.keys(parsed.metadata!).sort(),
    );
  });

  it('is the value a key that names nothing parses to', () => {
    const defaults = defaultIniMetadata();
    const parsed = scanIni([iniFile('[song]\nname = Named\n')]);

    expect(parsed.metadata!.artist).toBe(defaults.artist);
    expect(parsed.metadata!.diff_drums).toBe(defaults.diff_drums);
    expect(stripDefaultIniMetadata(parsed.metadata!)).toEqual({name: 'Named'});
  });
});
