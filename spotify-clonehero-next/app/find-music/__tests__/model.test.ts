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
    songLength: 180_000,
    albumArtMd5: null,
    groupId: 1,
    hasVideoBackground: false,
    isInstalled: false,
    ...rest,
    instruments: {
      drums: null,
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
    minPlays: 0,
    evidence: new Set(),
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
              drums: 5,
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
      value: 91,
      parts: [
        {label: 'Artist affinity', points: 55},
        {label: 'Available charts', points: 6},
        {label: 'Instrument coverage', points: 20},
        {label: 'Chart freshness', points: 10},
      ],
    });
  });
});

describe('find music filtering', () => {
  const fullBand = chart({
    md5: 'full-band',
    isInstalled: true,
    instruments: {drums: 5, guitar: 5},
  });
  const splitBand = [
    chart({md5: 'drums', instruments: {drums: 5}}),
    chart({md5: 'guitar', instruments: {guitar: 5}}),
  ];

  test('combines every music filter with AND semantics', () => {
    const matching = music({
      key: 'matching',
      playCount: 12,
      playlists: ['Mix'],
      albums: ['Album'],
      charts: [fullBand],
    });
    const noAlbum = music({
      key: 'no-album',
      playCount: 12,
      playlists: ['Mix'],
      charts: [fullBand],
    });
    const fewPlays = music({
      key: 'few-plays',
      playCount: 9,
      playlists: ['Mix'],
      albums: ['Album'],
      charts: [fullBand],
    });
    expect(
      applyMusicFilters(
        [noAlbum, matching, fewPlays],
        filters({
          install: 'only-installed',
          instruments: new Set(['drums', 'guitar']),
          minPlays: 10,
          evidence: new Set(['history', 'playlist', 'album']),
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
          instruments: new Set(['drums', 'guitar']),
        }),
      ),
    ).toEqual([]);
  });

  test('treats Chorus difficulty -1 as an instrument not being charted', () => {
    const absent = music({
      key: 'absent',
      charts: [chart({md5: 'absent', instruments: {drums: -1}})],
    });
    expect(
      applyMusicFilters([absent], filters({instruments: new Set(['drums'])})),
    ).toEqual([]);
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

  test('installed filters use song-level state when the exact Chorus version differs', () => {
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
    expect(
      applyMusicFilters(
        [otherVersionInstalled],
        filters({install: 'only-installed'}),
      ),
    ).toEqual([otherVersionInstalled]);
  });

  test('radar ignores direct-song controls but keeps chart filters', () => {
    const matching = radar({
      key: 'matching',
      artistPlayCount: 20,
      charts: [fullBand],
    });
    const cold = radar({key: 'cold', artistPlayCount: 0, charts: [fullBand]});
    expect(
      applyRadarFilters(
        [cold, matching],
        filters({
          minPlays: 100,
          evidence: new Set(['playlist']),
          install: 'only-installed',
          instruments: new Set(['drums', 'guitar']),
        }),
      ),
    ).toEqual([cold, matching]);
    expect(
      applyRadarFilters(
        [matching],
        filters({
          install: 'hide-installed',
        }),
      ),
    ).toEqual([]);
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

  test('supports updated and play-count directions', () => {
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
    expect(
      sortMusicSongs([older, newer], {key: 'plays', direction: 'asc'}),
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
