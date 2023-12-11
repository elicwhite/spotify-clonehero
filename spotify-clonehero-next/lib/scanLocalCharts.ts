import ini from 'ini';

export type SongIniData = {
  name: string;
  artist: string;
  charter: string;
  diff_drums: number;
};

export type SongAccumulator = {
  artist: string;
  song: string;
  lastModified: number;
  charter: string;
  data: SongIniData;
};

export default async function scanLocalCharts(
  directoryHandle: FileSystemDirectoryHandle,
  accumulator: SongAccumulator[],
  callbackPerSong: Function,
) {
  let newestDate = 0;
  let songIniData = null;

  for await (const subHandle of directoryHandle.values()) {
    if (subHandle.kind == 'directory') {
      await scanLocalCharts(subHandle, accumulator, callbackPerSong);
    }

    if (subHandle.kind == 'file') {
      const file = await subHandle.getFile();

      if (subHandle.name == 'song.ini') {
        const text = await file.text();
        const values = ini.parse(text);
        songIniData = values?.song;
      }

      if (file.lastModified > newestDate) {
        newestDate = file.lastModified;
      }
    }
  }

  if (songIniData) {
    accumulator.push({
      artist: songIniData?.artist,
      song: songIniData?.name,
      lastModified: newestDate,
      charter: songIniData?.charter,
      data: songIniData,
    });
    callbackPerSong();
  }
}
