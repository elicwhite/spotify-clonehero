import {authenticate} from './auth.js';
import SpotifyWebApi from 'spotify-web-api-node';
import { stringify } from 'csv-stringify';
import { parse } from 'csv-parse';
import path from 'path';
import fs from 'fs';

const OUTPUT_FILE = path.join(process.cwd(), 'spotifyapidata.csv')
const scopes = ['user-read-private', 'user-read-email', 'user-read-recently-played', 'playlist-read-private'];

async function run() {
  const accessToken = await authenticate({scopes});

  const spotifyApi = new SpotifyWebApi();
  spotifyApi.setAccessToken(accessToken);
  
  let beforeCursor = await getInitialBeforeCursor();
  
  // const writableStream = fs.createWriteStream(OUTPUT_FILE, {flags: 'a'});

  const stringifier = stringify({
    header: !fs.existsSync(OUTPUT_FILE), 
    columns: ['timestamp', 'artist', 'track', 'source'],
  })

  let counter = 0;

  // const NUM_STEPS = 5;
  // for (var i = 0; i < NUM_STEPS; i++) {
  //   if (beforeCursor == null) {
  //     break;
  //   }

    const result = await getMyRecentlyPlayedTracks(spotifyApi, {
      before: beforeCursor
    })

    result.recentTracks.forEach((play) => {
      counter++;

        console.log(play);
      // stringifier.write([ play.timestamp, play.artist, play.trackName, 'api' ]);
    });

    // data = data.concat(result.recentTracks);

    // beforeCursor = result.beforeCursor;
  // }

  console.log(`Found ${counter} plays. Ended at`, beforeCursor);
  // stringifier.pipe(writableStream);
  // stringifier.end();

  // if (data.length == 0) {
  //   console.log('No data recieved');
  // }
  // data.forEach(item => {
  //   console.log(`${item.timestamp} ${item.artist} ${item.trackName}`);
  // })
}

async function getInitialBeforeCursor() {
  if (!fs.existsSync(OUTPUT_FILE)) {
    return Date.now();
  }
  // const foo = fs.readFileSync('asdf.csv');
  // console.log('foo,', foo)
  const stream = fs
    .createReadStream(OUTPUT_FILE)
    .pipe(parse({
      columns: true
    }));

  let lastTrack = null;
  for await (const track of stream) {
    lastTrack = track;
  }

  if (lastTrack == null) {
    return Date.now();
  } 

  return Date.parse(lastTrack.timestamp);
}

async function getMyRecentlyPlayedTracks(spotifyApi, {before}) {
  const recents = await spotifyApi.getMyRecentlyPlayedTracks({
    limit : 50,
    // before: before,
    after: 1697389769186,
  })

  const recentTracks = recents.body.items.map(item => {
    const artist = item.track.artists.map(artist => artist.name).join(' & ');
    const trackName = item.track.name;
    const timestamp = item.played_at;
    
    return {
      artist, trackName, timestamp
    };
  });

  return {
    recentTracks,
    beforeCursor: recents.body.cursors?.before
  }
}

run().catch(function(err) {
    console.log('Something went wrong!', err);
  });