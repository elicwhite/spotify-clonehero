import fs from 'fs';
import {parse} from 'csv-parse';
import path from 'path';
import os from 'node:os';
import {levenshteinEditDistance} from 'levenshtein-edit-distance';

const CLONE_HERO_SONGS_FOLDER = path.join(os.homedir(), 'Clone Hero', 'Songs');
const CHORUS_DUMP = path.join(
  os.homedir(),
  'Downloads',
  'chorus_2023-10-02.csv',
);
const SPOTIFY_DATA_DUMP_FOLDER = path.join(
  os.homedir(),
  'Downloads',
  'SpotifyData-Aug-26',
);

async function run() {
  const artistTrackPlays = createPlaysMapOfSpotifyData();
  const isInstalled = await createIsInstalledFilter();
  const notInstalledSongs = await filterAndGroupCharts(
    artistTrackPlays,
    isInstalled,
  );

  const results = sortAndFilterCharts(notInstalledSongs);

  results.forEach(result => {
    console.log(
      `${result.spotifyPlayCount}, ${result.artist}, ${result.song}, ${result.recommendedChart.link}`,
    );
  });
}

run();

function sortAndFilterCharts(artistTrackChartData) {
  /* {
    spotifyPlayCount: 10,
    artist: "There For Tomorrow"
    song: "A LIttle Faster"
    recommendedChart: Chart
  }
  */
  const results = [];

  for (const [artist, songs] of artistTrackChartData) {
    for (const [song, {plays, charts}] of songs) {
      let recommendedChart = charts[0];

      for (let chartIndex = 1; chartIndex < charts.length; chartIndex++) {
        const chart = charts[chartIndex];

        // Prefer newer charts from the same charter
        if (
          chart.charter == recommendedChart.charter &&
          new Date(chart.uploadedAt) < new Date(recommendedChart.uploadedAt)
        ) {
          continue;
        }

        // Prefer Harmonix
        if (
          recommendedChart.charter == 'Harmonix' &&
          chart.charter != 'Harmonix'
        ) {
          continue;
        }

        // Prefer official tracks
        if (['Harmonix', 'Neversoft'].includes(recommendedChart.charter)) {
          continue;
        }

        // Prefer charts with drums
        if (recommendedChart.diff_drums != '' && chart.diff_drums == '') {
          continue;
        }

        recommendedChart = chart;
      }

      if (charts.length == 1) {
        results.push({
          spotifyPlayCount: plays,
          artist,
          song,
          recommendedChart,
        });
        continue;
      }
    }
  }

  results.sort((a, b) => {
    return a.spotifyPlayCount - b.spotifyPlayCount;
  });

  return results;
}

async function filterAndGroupCharts(spotifyData, isInstalledFilter) {
  const notInstalledSongs = new Map();

  await scanChorusDump(async track => {
    const artistTracks = spotifyData.get(track.artist);
    if (artistTracks == null) {
      return;
    }

    const trackPlays = artistTracks.get(track.name);
    if (trackPlays == null) {
      return;
    }

    // Check if it matches song difficulty / track requirements
    // if (!(track.diff_guitar >= 8 || track.diff_bass >= 8 || track.diff_drums >= 8)) {
    if (!(track.diff_drums >= 8)) {
      return;
    }

    if (!isInstalledFilter(track.artist, track.name)) {
      if (notInstalledSongs.get(track.artist) == null) {
        notInstalledSongs.set(track.artist, new Map());
      }

      if (notInstalledSongs.get(track.artist).get(track.name) == null) {
        notInstalledSongs
          .get(track.artist)
          .set(track.name, {plays: trackPlays, charts: []});
      }

      notInstalledSongs.get(track.artist).get(track.name).charts.push(track);
    }
  });

  return notInstalledSongs;
}

// async function createIsInstalledFilter() {
//   const installedSongs = fs.readFileSync('/Users/eliwhite/Downloads/FolderList.txt', 'utf-8')
//     .split('\n')
//     .filter(row => row.includes(' - '))
//     .map(row => row.trim())
//     .map(row => row.substring(row.lastIndexOf('\\')+1));

//   console.log(installedSongs);
//   process.exit(0)

// }

async function createIsInstalledFilter() {
  // const installedSongs = fs.readdirSync(CLONE_HERO_SONGS_FOLDER, {withFileTypes: true})
  //   .filter(dirent => dirent.isDirectory())
  //   .map(dirent => dirent.name);

  const installedSongs = fs
    .readFileSync('/Users/eliwhite/Downloads/FolderList.txt', 'utf-8')
    .split('\n')
    .filter(row => row.includes(' - '))
    .map(row => row.trim())
    .map(row => row.substring(row.lastIndexOf('\\') + 1));

  const installedArtistsSongs = new Map();

  for (const folderName of installedSongs) {
    const [artist, song] = folderName.split(' - ').map(s => s.trim());

    if (installedArtistsSongs.get(artist) == null) {
      installedArtistsSongs.set(artist, []);
    }

    installedArtistsSongs.get(artist).push(song);
  }

  return function isInstalled(artist, song) {
    let likelyArtist;

    for (const installedArtist of installedArtistsSongs.keys()) {
      const artistDistance = levenshteinEditDistance(installedArtist, artist);
      if (artistDistance <= 1) {
        likelyArtist = installedArtist;
      }
    }

    const artistSongs = installedArtistsSongs.get(likelyArtist);

    if (artistSongs == null) {
      return false;
    }

    let likelySong;

    for (const installedSong of artistSongs) {
      const songDistance = levenshteinEditDistance(installedSong, song);
      if (songDistance <= 1) {
        likelySong = installedSong;
      }
    }

    if (likelySong != null) {
      return true;
    }

    // if (artistSongs.includes(song)) {
    //   return true;
    // }

    // Some installed songs have (2x double bass) suffixes.
    return artistSongs.some(artistSong => artistSong.includes(song));
  };
}

async function scanChorusDump(processTrack) {
  const stream = fs.createReadStream(CHORUS_DUMP).pipe(
    parse({
      columns: true,
    }),
  );
  for await (const track of stream) {
    await processTrack(track);
  }
}

function createPlaysMapOfSpotifyData() {
  const artistsTracks = new Map();

  const spotifyHistoryFiles = fs
    .readdirSync(SPOTIFY_DATA_DUMP_FOLDER)
    .filter(f => f.endsWith('.json'));

  for (const spotifyHistoryFile of spotifyHistoryFiles) {
    const history = JSON.parse(
      fs.readFileSync(
        path.join(SPOTIFY_DATA_DUMP_FOLDER, spotifyHistoryFile),
        'utf8',
      ),
    );

    for (const song of history) {
      if (song.reason_end == 'fwdbtn') {
        continue;
      }

      const artist = song.master_metadata_album_artist_name;
      const track = song.master_metadata_track_name;

      let tracksPlays = artistsTracks.get(artist);
      if (tracksPlays == null) {
        tracksPlays = new Map();
        artistsTracks.set(artist, tracksPlays);
      }
      tracksPlays.set(track, (tracksPlays.get(track) ?? 0) + 1);
    }
  }

  return artistsTracks;
}
