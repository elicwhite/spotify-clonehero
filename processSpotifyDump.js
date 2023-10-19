import fs from 'fs';
import { stringify } from 'csv-stringify';
import path from 'path';
import os from 'node:os';

const SPOTIFY_DATA_DUMP_FOLDER = path.join(os.homedir(), 'Downloads', 'Hoph20SpotifyData');
const OUTPUT_FILE = path.join(process.cwd(), 'hopspotifydata.csv')

async function run() {
  const artistTrackPlays = createPlaysMapOfSpotifyData();

  const writableStream = fs.createWriteStream(OUTPUT_FILE);

  const stringifier = stringify({
    header: true, columns: ['timestamp', 'artist', 'track', 'source'],
    // delimiter: ':'
  })

  artistTrackPlays.forEach(play => {
    stringifier.write([ play.timestamp, play.artist, play.track, 'dump' ]);
  })

  stringifier.pipe(writableStream);
  stringifier.end();
}

run();

function createPlaysMapOfSpotifyData() {
  const plays = [];

  const spotifyHistoryFiles = fs.readdirSync(SPOTIFY_DATA_DUMP_FOLDER).filter(f => f.endsWith('.json'));

  for (const spotifyHistoryFile of spotifyHistoryFiles) {
    const history = JSON.parse(fs.readFileSync(path.join(SPOTIFY_DATA_DUMP_FOLDER, spotifyHistoryFile), 'utf8'));

    for (const song of history) {
      const artist = song.master_metadata_album_artist_name;
      const track = song.master_metadata_track_name;

      if (artist == null || track == null || song.reason_end == 'fwdbtn') {
        continue;
      }

      plays.push({
        artist,
        track,
        timestamp: song.ts,
      })
    }
  }

  plays.sort((a, b) => {
    return Date.parse(b) - Date.parse(a);
  });

  return plays;
} 