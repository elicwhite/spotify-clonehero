'use client';

import {useCallback} from 'react';
import {SngStream} from '@eliwhite/parse-sng';

// const URL =
// 'https://www.enchor.us/download?md5=0acb9bad1d27efe83af51587bd20de0a&isSng=true';
const URL = 'https://files.enchor.us/0acb9bad1d27efe83af51587bd20de0a.sng';

export const songIniOrder = [
  'name',
  'artist',
  'album',
  'genre',
  'year',
  'charter',
  'song_length',
  'diff_band',
  'diff_guitar',
  'diff_guitar_coop',
  'diff_rhythm',
  'diff_bass',
  'diff_drums',
  'diff_drums_real',
  'diff_keys',
  'diff_guitarghl',
  'diff_guitar_coop_ghl',
  'diff_rhythm_ghl',
  'diff_bassghl',
  'preview_start_time',
  'icon',
  'loading_phrase',
  'album_track',
  'playlist_track',
  'modchart',
  'video_start_time',
  'five_lane_drums',
  'pro_drums',
] as const;
export default function SongsDownloader() {
  const handler = useCallback(async () => {
    const dirHandle = await window.showDirectoryPicker({
      mode: 'readwrite',
    });

    const songDirHandle = await dirHandle.getDirectoryHandle(
      'MyArtist - MySong' + Math.round(Math.random() * 10000),
      {
        create: true,
      },
    );

    const response = await fetch(URL, {
      headers: {
        accept: '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'sec-fetch-dest': 'empty',
      },
      referrerPolicy: 'no-referrer',
      body: null,
      method: 'GET',
      credentials: 'omit',
    });

    const body = response.body;
    if (body == null) {
      return;
    }

    const sngStream = new SngStream(body);
    sngStream.on('file', async (file, stream, nextFile) => {
      const fileHandle = await songDirHandle.getFileHandle(file, {
        create: true,
      });
      const writableStream = await fileHandle.createWritable();
      await stream.pipeTo(writableStream);
      if (nextFile) {
        nextFile();
      } else {
        console.log('test.sng has been fully parsed');
      }
    });

    sngStream.on('error', error => console.log(error));

    sngStream.start();
  }, []);

  return (
    <>
      <button onClick={() => handler()}>Download Song</button>
    </>
  );
}
