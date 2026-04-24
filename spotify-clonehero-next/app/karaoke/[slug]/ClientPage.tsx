'use client';

import {useEffect, useState} from 'react';
import {Player} from '@remotion/player';
import {ChartResponseEncore} from '@/lib/chartSelection';
import {
  getChartAndAudioFiles,
  ParsedChart,
  Files,
} from '@/lib/preview/chorus-chart-processing';
import {searchAdvanced} from '@/lib/search-encore';
import {parseLyrics, type LyricLine} from '@/lib/karaoke/parse-lyrics';
import {KaraokeVideo} from '../KaraokeVideo';
import {TREATMENTS, type TreatmentId} from '../treatments/types';
import ChartDetailLayout from '@/components/chart-detail/ChartDetailLayout';
import SongHeader from '@/components/chart-detail/SongHeader';

const FPS = 30;

interface KaraokeData {
  metadata: ChartResponseEncore;
  lines: LyricLine[];
  audioUrls: string[];
  albumArtUrl: string;
  songLength: number;
}

function audioFilesToBlobUrls(audioFiles: Files): string[] {
  return audioFiles.map(f => {
    const ext = f.fileName.split('.').pop()?.toLowerCase();
    let mime = 'audio/ogg';
    if (ext === 'mp3') mime = 'audio/mpeg';
    else if (ext === 'opus') mime = 'audio/opus';
    else if (ext === 'wav') mime = 'audio/wav';
    const blob = new Blob([f.data as Uint8Array<ArrayBuffer>], {type: mime});
    return URL.createObjectURL(blob);
  });
}

export default function ClientPage({md5}: {md5: string}) {
  const [karaokeData, setKaraokeData] = useState<KaraokeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [treatment, setTreatment] = useState<TreatmentId>('highlight');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const chartResponse = await searchAdvanced({hash: md5});
        const track = chartResponse.data[0];
        if (!track) {
          setError('Chart not found');
          return;
        }

        const {chart, audioFiles, metadata} =
          await getChartAndAudioFiles(track);

        if (cancelled) return;

        const vocals = chart.vocalTracks.parts.vocals;
        const rawLyrics = vocals?.notePhrases.flatMap(p => p.lyrics) ?? [];
        const vocalPhrases = vocals?.notePhrases ?? [];
        const lines = parseLyrics(rawLyrics, vocalPhrases);

        if (lines.length === 0) {
          setError('Could not parse lyrics from this chart');
          return;
        }

        const audioUrls = audioFilesToBlobUrls(audioFiles);
        const albumArtUrl = `https://files.enchor.us/${metadata.albumArtMd5}.jpg`;

        // Song length from metadata or estimate from last lyric line
        const songLength =
          (metadata.song_length ?? 0) > 0
            ? metadata.song_length!
            : lines[lines.length - 1].phraseEndMs + 5000;

        setKaraokeData({
          metadata,
          lines,
          audioUrls,
          albumArtUrl,
          songLength,
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load chart',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [md5]);

  // Clean up blob URLs on unmount
  useEffect(() => {
    return () => {
      karaokeData?.audioUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [karaokeData]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
        <p className="text-muted-foreground">Loading chart and audio...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  if (!karaokeData) return null;

  const durationInFrames = Math.ceil((karaokeData.songLength / 1000) * FPS);

  return (
    <ChartDetailLayout
      backHref="/karaoke"
      sidebar={
        <div className="space-y-2">
          <label className="text-sm font-medium">Video Style</label>
          <div className="flex flex-col gap-2">
            {TREATMENTS.map(t => (
              <button
                key={t.id}
                onClick={() => setTreatment(t.id)}
                className={`px-4 py-2 rounded font-medium cursor-pointer transition-colors text-left ${
                  treatment === t.id
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-foreground hover:bg-accent'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      }>
      <div className="md:pt-4 md:px-4 pt-2 flex-1 flex flex-col overflow-hidden">
        <SongHeader
          name={karaokeData.metadata.name}
          artist={karaokeData.metadata.artist}
          charter={karaokeData.metadata.charter}
        />

        <div className="flex-1 flex items-start justify-center">
          <Player
            component={KaraokeVideo}
            inputProps={{
              lines: karaokeData.lines,
              audioUrls: karaokeData.audioUrls,
              albumArtUrl: karaokeData.albumArtUrl,
              treatment,
            }}
            durationInFrames={durationInFrames}
            compositionWidth={1920}
            compositionHeight={1080}
            fps={FPS}
            controls
            numberOfSharedAudioTags={8}
            acknowledgeRemotionLicense
            errorFallback={({error}) => (
              <div className="flex items-center justify-center h-full bg-black text-red-400 p-8 text-center">
                <p>{error.message}</p>
              </div>
            )}
            style={{width: '100%', maxWidth: 1280, aspectRatio: '16/9'}}
          />
        </div>
      </div>
    </ChartDetailLayout>
  );
}
