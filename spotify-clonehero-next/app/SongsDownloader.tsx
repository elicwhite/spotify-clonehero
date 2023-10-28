'use client';

import {useCallback, useState} from 'react';
import {SngStream} from 'parse-sng';

// const URL =
// 'https://www.enchor.us/download?md5=0acb9bad1d27efe83af51587bd20de0a&isSng=true';
const URL = 'https://files.enchor.us/0acb9bad1d27efe83af51587bd20de0a.sng';

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

    const sngStream = new SngStream((start, end) => response.body);
    // sngStream.on('file', async (file, stream) => {
    //   console.log('file', file, stream);
    //   const fileHandle = await songDirHandle.getFileHandle(file, {
    //     create: true,
    //   });
    //   const writableStream = await fileHandle.createWritable();
    //   stream.pipeTo(writableStream);
    // });

    sngStream.on('files', files => {
      console.log('files');
    });
    sngStream.on('header', h => console.log('header', h));

    sngStream.on('end', () => console.log('test.sng has been fully parsed'));

    sngStream.on('error', error => console.log(error));

    // debugger;
    sngStream.start();

    // await response?.body?.pipeTo(writableStream);
  }, []);

  return (
    <>
      <button onClick={() => handler()}>Download Song</button>
    </>
  );
}
