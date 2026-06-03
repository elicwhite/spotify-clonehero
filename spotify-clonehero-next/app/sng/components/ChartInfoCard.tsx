'use client';

import {useEffect, useMemo} from 'react';
import {Music} from 'lucide-react';
import {
  InstrumentImage,
  RENDERED_INSTRUMENTS,
  type AllowedInstrument,
} from '@/components/ChartInstruments';
import {Card, CardContent} from '@/components/ui/card';
import {
  parseChartPreview,
  DIFFICULTY_LABEL,
} from '@/lib/sng/parse-chart-preview';
import type {FileEntry} from '@/lib/chart-export';

function isRenderedInstrument(
  instrument: string,
): instrument is AllowedInstrument {
  return (RENDERED_INSTRUMENTS as readonly string[]).includes(instrument);
}

export default function ChartInfoCard({files}: {files: FileEntry[]}) {
  // Re-parse whenever the file set changes (add/delete). Keyed on the file
  // names + sizes so identical content doesn't trigger needless re-parses.
  const fingerprint = files
    .map(f => `${f.fileName}:${f.data.length}`)
    .join('|');

  const info = useMemo(() => {
    try {
      return parseChartPreview(files);
    } catch (e) {
      console.warn('Failed to parse chart for preview:', e);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);

  // Create the object URL during render (memoized on the art bytes) and revoke
  // the previous one in an effect cleanup — avoids setState-in-effect.
  const albumArtUrl = useMemo(
    () =>
      info?.albumArt
        ? URL.createObjectURL(
            new Blob([info.albumArt as Uint8Array<ArrayBuffer>], {
              type: 'image/jpeg',
            }),
          )
        : null,
    [info],
  );

  useEffect(() => {
    if (!albumArtUrl) return;
    return () => URL.revokeObjectURL(albumArtUrl);
  }, [albumArtUrl]);

  if (!info) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
          <Music className="h-8 w-8" />
          <p className="text-sm">
            No chart found in this package yet. Add a{' '}
            <code className="text-xs">.chart</code> or{' '}
            <code className="text-xs">.mid</code> file to see a preview.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-stretch">
        <div className="flex-shrink-0 bg-muted">
          {albumArtUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={albumArtUrl}
              alt={`${info.name} album art`}
              className="h-full w-24 object-cover sm:w-32"
            />
          ) : (
            <div className="flex h-full w-24 items-center justify-center sm:w-32">
              <Music className="h-8 w-8 text-muted-foreground" />
            </div>
          )}
        </div>

        <CardContent className="flex flex-grow flex-col gap-2 p-4">
          <div>
            <h3 className="text-base font-bold leading-tight sm:text-lg">
              {info.name}{' '}
              <span className="font-normal text-muted-foreground">by</span>{' '}
              {info.artist}
            </h3>
            <p className="text-sm text-muted-foreground">
              charted by {info.charter}
            </p>
          </div>

          <div className="mt-1 flex flex-wrap gap-2">
            {info.instruments.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No instrument tracks detected.
              </p>
            )}
            {info.instruments.map(({instrument, difficulties, intensity}) => (
              <div
                key={instrument}
                className="flex flex-col items-center gap-1 rounded-md bg-muted/50 px-3 py-2"
                title={`${instrument}${
                  difficulties[0]
                    ? ` · ${DIFFICULTY_LABEL[difficulties[0]]}`
                    : ''
                }`}>
                {difficulties[0] && (
                  <span className="text-xs font-medium text-muted-foreground">
                    {DIFFICULTY_LABEL[difficulties[0]]}
                  </span>
                )}
                <div className="relative">
                  {isRenderedInstrument(instrument) ? (
                    <InstrumentImage
                      instrument={instrument}
                      size="md"
                      classNames="h-8 w-8"
                    />
                  ) : (
                    <span className="text-sm font-medium capitalize">
                      {instrument}
                    </span>
                  )}
                  {intensity != null && (
                    <span className="absolute -bottom-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground">
                      {intensity}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </div>
    </Card>
  );
}
