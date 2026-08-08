import {
  applyHeld,
  applyMusicFilters,
  applyRadarFilters,
  createHoldState,
  scoreMusicSong,
  scoreRadarSong,
  sortMusicSongs,
  sortRadarSongs,
  stageSnapshot,
} from '../model';
import type {
  FindMusicChart,
  FindMusicFilters,
  FindMusicSong,
  RadarSong,
} from '../types';

type ChartOverrides = Omit<Partial<FindMusicChart>, 'md5' | 'instruments'> & {
  md5: string;
  instruments?: Partial<FindMusicChart['instruments']>;
};

function chart(overrides: ChartOverrides): FindMusicChart {
  const {md5, instruments, ...rest} = overrides;
  return {
    md5,
    artist: 'Artist',
    name: 'Song',
    charter: 'Charter',
    modifiedTime: '2024-01-01T00:00:00.000Z',
    albumArtMd5: null,
    groupId: 1,
    hasVideoBackground: false,
    isInstalled: false,
    ...rest,
    instrumentPresence: {
      guitar: false,
      bass: false,
      keys: false,
      proDrums: false,
    },
    instruments: {
      guitar: null,
      bass: null,
      keys: null,
      proDrums: null,
      ...instruments,
    },
  };
}

function music(
  overrides: Partial<FindMusicSong> & Pick<FindMusicSong, 'key'>,
): FindMusicSong {
  const {key, ...rest} = overrides;
  const charts = rest.charts ?? [chart({md5: `${key}-chart`})];
  return {
    key,
    artist: 'Artist',
    song: 'Song',
    playCount: 0,
    playlists: [],
    albums: [],
    spotifyUrl: null,
    hasInstalledChart:
      rest.hasInstalledChart ?? charts.some(item => item.isInstalled),
    charts,
    ...rest,
  };
}

function radar(
  overrides: Partial<RadarSong> & Pick<RadarSong, 'key'>,
): RadarSong {
  const {key, ...rest} = overrides;
  const charts = rest.charts ?? [chart({md5: `${key}-chart`})];
  return {
    key,
    artist: 'Artist',
    song: 'Song',
    artistPlayCount: 0,
    spotifyUrl: null,
    hasInstalledChart:
      rest.hasInstalledChart ?? charts.some(item => item.isInstalled),
    charts,
    ...rest,
  };
}

function filters(overrides: Partial<FindMusicFilters> = {}): FindMusicFilters {
  return {
    install: 'all',
    instruments: new Set(),
    query: '',
    exclusions: [],
    exclusionDraft: '',
    ...overrides,
  };
}

describe('find music scoring', () => {
  test('music scoring exposes capped, independent evidence parts', () => {
    const result = scoreMusicSong(
      music({
        key: 'known',
        playCount: 1_000,
        playlists: ['One', 'Two', 'Three'],
        albums: ['One', 'Two', 'Three'],
        charts: [chart({md5: 'installed', isInstalled: true})],
      }),
    );
    expect(result).toEqual({
      value: 100,
      parts: [
        {label: 'Listening history', points: 55},
        {label: 'Spotify playlists', points: 24},
        {label: 'Spotify albums', points: 20},
        {label: 'Installed chart', points: 1},
      ],
    });
  });

  test('radar scoring labels affinity, availability, coverage, and freshness', () => {
    const result = scoreRadarSong(
      radar({
        key: 'candidate',
        artistPlayCount: 100,
        charts: [
          chart({
            md5: 'full-band',
            modifiedTime: '2026-02-01T00:00:00Z',
            instruments: {
              guitar: 5,
              bass: 5,
              keys: 5,
              proDrums: 5,
            },
          }),
          chart({md5: 'alternate'}),
        ],
      }),
    );
    expect(result).toEqual({
      value: 87,
      parts: [
        {label: 'Artist affinity', points: 55},
        {label: 'Available charts', points: 6},
        {label: 'Instrument coverage', points: 16},
        {label: 'Chart freshness', points: 10},
      ],
    });
  });
});

describe('find music filtering', () => {
  const fullBand = chart({
    md5: 'full-band',
    isInstalled: true,
    instruments: {proDrums: 5, guitar: 5},
  });
  const splitBand = [
    chart({md5: 'pro-drums', instruments: {proDrums: 5}}),
    chart({md5: 'guitar', instruments: {guitar: 5}}),
  ];

  test('combines text, install and instrument filters with AND semantics', () => {
    const matching = music({
      key: 'matching',
      artist: 'The Matching Artist',
      song: 'Midnight Drive',
      charts: [chart({md5: 'available', instruments: {guitar: 5}})],
    });
    const installed = music({
      key: 'installed',
      artist: 'The Matching Artist',
      song: 'Midnight Drive',
      charts: [fullBand],
    });
    const wrongText = music({
      key: 'wrong-text',
      artist: 'Another Artist',
      song: 'Daylight',
      charts: [chart({md5: 'other', instruments: {guitar: 5}})],
    });
    expect(
      applyMusicFilters(
        [installed, wrongText, matching],
        filters({
          install: 'hide-installed',
          instruments: new Set(['guitar']),
          query: 'matching drive',
        }),
      ),
    ).toEqual([matching]);
  });

  test('requires selected instruments on the same chart version', () => {
    const split = music({key: 'split', charts: splitBand});
    expect(
      applyMusicFilters(
        [split],
        filters({
          instruments: new Set(['proDrums', 'guitar']),
        }),
      ),
    ).toEqual([]);
  });

  test('keeps only chart versions that contain every selected instrument', () => {
    const guitar = chart({md5: 'guitar', instruments: {guitar: 5}});
    const proDrums = chart({
      md5: 'pro-drums',
      instruments: {proDrums: 4},
    });
    const both = chart({
      md5: 'both',
      instruments: {guitar: 3, proDrums: 3},
    });
    const source = music({key: 'versions', charts: [guitar, proDrums, both]});

    const [filtered] = applyMusicFilters(
      [source],
      filters({instruments: new Set(['guitar'])}),
    );

    expect(filtered.charts.map(item => item.md5)).toEqual(['guitar', 'both']);
    expect(source.charts.map(item => item.md5)).toEqual([
      'guitar',
      'pro-drums',
      'both',
    ]);
  });

  test('treats Chorus difficulty -1 as an instrument not being charted', () => {
    const absent = music({
      key: 'absent',
      charts: [chart({md5: 'absent', instruments: {proDrums: -1}})],
    });
    expect(
      applyMusicFilters(
        [absent],
        filters({instruments: new Set(['proDrums'])}),
      ),
    ).toEqual([]);
  });

  test('uses track-level presence when Chorus intensity metadata is absent', () => {
    const trackBacked = chart({
      md5: 'b26561a9d61bd5f4d2454a9169a42654',
      instruments: {guitar: -1, bass: -1},
    });
    trackBacked.instrumentPresence.guitar = true;
    trackBacked.instrumentPresence.bass = true;

    const result = applyMusicFilters(
      [music({key: 'violet-hill', charts: [trackBacked]})],
      filters({instruments: new Set(['guitar', 'bass'])}),
    );

    expect(result).toHaveLength(1);
    expect(result[0].charts).toEqual([trackBacked]);
  });

  test('hide-installed excludes a song with any installed chart', () => {
    const installed = music({key: 'installed', charts: [fullBand]});
    const available = music({key: 'available', charts: splitBand});
    expect(
      applyMusicFilters(
        [installed, available],
        filters({
          install: 'hide-installed',
        }),
      ),
    ).toEqual([available]);
  });

  test('installed filter uses song-level state when the exact Chorus version differs', () => {
    const otherVersionInstalled = music({
      key: 'other-version',
      hasInstalledChart: true,
      charts: [chart({md5: 'chorus-version', isInstalled: false})],
    });
    expect(
      applyMusicFilters(
        [otherVersionInstalled],
        filters({install: 'hide-installed'}),
      ),
    ).toEqual([]);
  });

  test('text search is case-insensitive across artist and song', () => {
    const drive = music({
      key: 'drive',
      artist: 'Incubus',
      song: 'Drive',
    });
    const other = music({key: 'other', artist: 'Muse', song: 'Uprising'});

    expect(
      applyMusicFilters([other, drive], filters({query: 'INC drive'})),
    ).toEqual([drive]);
  });

  test('excludes music by case-insensitive artist, song, or charter substring', () => {
    const byArtist = music({
      key: 'artist',
      artist: 'blink-182',
      song: 'Always',
    });
    const bySong = music({
      key: 'song',
      artist: 'The Cure',
      song: 'Blink Three Times',
    });
    const byCharter = music({
      key: 'charter',
      artist: 'Muse',
      song: 'Uprising',
      charts: [chart({md5: 'charter', charter: 'BlinkCharting'})],
    });
    const visible = music({key: 'visible', artist: 'Incubus', song: 'Drive'});

    expect(
      applyMusicFilters(
        [byArtist, bySong, byCharter, visible],
        filters({exclusions: ['BLINK']}),
      ),
    ).toEqual([visible]);
  });

  test('applies a non-empty draft exclusion while it is being typed', () => {
    const excluded = music({key: 'excluded', artist: 'blink-182'});
    const visible = music({key: 'visible', artist: 'Incubus'});

    expect(
      applyMusicFilters(
        [excluded, visible],
        filters({exclusionDraft: ' blink '}),
      ),
    ).toEqual([visible]);
    expect(
      applyMusicFilters([excluded, visible], filters({exclusionDraft: '   '})),
    ).toEqual([excluded, visible]);
  });

  test('radar applies text and chart filters', () => {
    const matching = radar({
      key: 'matching',
      artist: 'Matching Artist',
      artistPlayCount: 20,
      charts: [chart({md5: 'matching', instruments: {guitar: 5}})],
    });
    const cold = radar({
      key: 'cold',
      artist: 'Other Artist',
      charts: [chart({md5: 'cold', instruments: {guitar: 5}})],
    });
    expect(
      applyRadarFilters(
        [cold, matching],
        filters({
          query: 'matching',
          instruments: new Set(['guitar']),
        }),
      ),
    ).toEqual([matching]);
  });

  test('radar removes chart versions that do not satisfy the instrument filter', () => {
    const source = radar({
      key: 'radar-versions',
      charts: [
        chart({md5: 'guitar', instruments: {guitar: 4}}),
        chart({md5: 'pro-drums', instruments: {proDrums: 4}}),
      ],
    });

    const [filtered] = applyRadarFilters(
      [source],
      filters({instruments: new Set(['proDrums'])}),
    );

    expect(filtered.charts.map(item => item.md5)).toEqual(['pro-drums']);
  });

  test('radar applies committed and draft exclusions to charter metadata', () => {
    const committed = radar({key: 'committed', artist: 'blink-182'});
    const drafting = radar({
      key: 'drafting',
      charts: [chart({md5: 'drafting', charter: 'NightHawk'})],
    });
    const visible = radar({key: 'visible', artist: 'Incubus'});

    expect(
      applyRadarFilters(
        [committed, drafting, visible],
        filters({exclusions: ['blink'], exclusionDraft: 'hawk'}),
      ),
    ).toEqual([visible]);
  });
});

describe('find music sorting', () => {
  test('sorts without mutation and uses identity tie-breakers', () => {
    const beta = music({key: 'beta', artist: 'Beta', song: 'Same'});
    const alphaZ = music({key: 'z', artist: 'Alpha', song: 'Same'});
    const alphaA = music({key: 'a', artist: 'Alpha', song: 'Same'});
    const input = [beta, alphaZ, alphaA];
    expect(sortMusicSongs(input, {key: 'score', direction: 'desc'})).toEqual([
      alphaA,
      alphaZ,
      beta,
    ]);
    expect(input).toEqual([beta, alphaZ, alphaA]);
  });

  test('supports updated directions', () => {
    const older = music({
      key: 'older',
      playCount: 20,
      charts: [chart({md5: 'old', modifiedTime: '2023-01-01T00:00:00Z'})],
    });
    const newer = music({
      key: 'newer',
      playCount: 2,
      charts: [chart({md5: 'new', modifiedTime: '2026-01-01T00:00:00Z'})],
    });
    expect(
      sortMusicSongs([older, newer], {key: 'updated', direction: 'desc'}),
    ).toEqual([newer, older]);
  });

  test('radar sort is score-first with deterministic ties', () => {
    const low = radar({key: 'low', artist: 'Zed', artistPlayCount: 1});
    const tiedB = radar({key: 'b', artist: 'Alpha', artistPlayCount: 30});
    const tiedA = radar({key: 'a', artist: 'Alpha', artistPlayCount: 30});
    expect(sortRadarSongs([low, tiedB, tiedA])).toEqual([tiedA, tiedB, low]);
  });
});

describe('held query snapshots', () => {
  test('holds row references and order until explicitly applied', () => {
    const alpha = music({key: 'alpha', playCount: 1});
    const beta = music({key: 'beta', playCount: 2});
    const initial = createHoldState([alpha, beta]);
    const changedBeta = {...beta, playCount: 8};
    const gamma = music({key: 'gamma', playCount: 3});
    const staged = stageSnapshot(initial, [gamma, changedBeta, alpha]);
    expect(staged.committed).toBe(initial.committed);
    expect(staged.committed).toEqual([alpha, beta]);
    expect(staged.pendingNewCount).toBe(1);
    expect(staged.pendingChangedCount).toBe(1);

    const applied = applyHeld(staged);
    expect(applied.committed).toEqual([gamma, changedBeta, alpha]);
    expect(applied.committed[1].playCount).toBe(8);
    expect(applied.pending).toBeNull();
    expect(applied.pendingNewCount).toBe(0);
    expect(applied.pendingChangedCount).toBe(0);
  });

  test('new count is based on keys, not changed evidence or row order', () => {
    const alpha = music({key: 'alpha', playCount: 1});
    const beta = music({key: 'beta', playCount: 2});
    const staged = stageSnapshot(createHoldState([alpha, beta]), [
      {...beta, playCount: 9},
      alpha,
    ]);
    expect(staged.pendingNewCount).toBe(0);
    expect(staged.pendingChangedCount).toBe(1);
  });

  test('holds source removals until apply just like new evidence', () => {
    const alpha = music({key: 'alpha'});
    const beta = music({key: 'beta'});
    const staged = stageSnapshot(createHoldState([alpha, beta]), [alpha]);
    expect(staged.committed).toEqual([alpha, beta]);
    expect(staged.pendingNewCount).toBe(0);
    expect(staged.pendingChangedCount).toBe(1);
    expect(applyHeld(staged).committed).toEqual([alpha]);
  });
});
