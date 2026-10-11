'use client';

import * as Sentry from '@sentry/nextjs';
import {useCallback, useRef, useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  browserReasonSentence,
  downloadFallbackText,
} from '@/components/file-access/DownloadFallbackNotice';
import {
  supportsDirectoryPicker,
  useSupportsDirectoryPicker,
} from '@/lib/file-access/capabilities';
import {
  downloadSong,
  getCachedSongsDirectoryHandle,
  getSongsDownloadFolder,
  pickSongsDirectory,
} from '@/lib/local-songs-folder';
import type {FindMusicChart} from './types';

export type ChartInstallState =
  | 'idle'
  | 'working'
  | 'installed'
  | 'downloaded'
  | 'error';

/** The download notice's words on this page. */
export const SONGS_FOLDER_DOWNLOAD_COPY = {
  folder: 'your Songs folder',
  action: 'Move each chart into your Songs folder, then scan again.',
} as const;

const DOWNLOAD_CHOICE_KEY = 'find-music:install-destination:v1';

type Destination =
  | {kind: 'songs-folder'; songsFolder: FileSystemDirectoryHandle}
  | {kind: 'browser-download'; browserIsReason: boolean};

function readDownloadChoice(): boolean {
  try {
    return window.localStorage.getItem(DOWNLOAD_CHOICE_KEY) === 'download';
  } catch {
    return false;
  }
}

function writeDownloadChoice(prefersDownload: boolean) {
  try {
    if (prefersDownload) {
      window.localStorage.setItem(DOWNLOAD_CHOICE_KEY, 'download');
    } else {
      window.localStorage.removeItem(DOWNLOAD_CHOICE_KEY);
    }
  } catch {
    // Without storage the dialog asks again next visit, which is harmless.
  }
}

/**
 * Installing a chart from the table: where it goes, the dialog that asks when
 * nobody has said, and what each chart's button shows.
 *
 * | Browser                            | Result                       |
 * | ---------------------------------- | ---------------------------- |
 * | No folder picker                   | Download. No prompt.         |
 * | Picker, Songs folder granted       | Install. No prompt.          |
 * | Picker, "Just download" chosen     | Download. No prompt.         |
 * | Picker, nothing chosen yet         | Dialog asks.                 |
 *
 * A granted Songs folder wins over a stored "Just download": the user picked
 * a folder after making that choice.
 */
export function useChartInstall() {
  const canPickFolders = useSupportsDirectoryPicker();
  const [prefersDownload, setPrefersDownload] = useState(
    () => typeof window !== 'undefined' && readDownloadChoice(),
  );
  const [states, setStates] = useState<Record<string, ChartInstallState>>({});
  const [asking, setAsking] = useState(false);
  const answerRef = useRef<((destination: Destination | null) => void) | null>(
    null,
  );
  const explainedRef = useRef(false);

  const answer = useCallback((destination: Destination | null) => {
    answerRef.current?.(destination);
    answerRef.current = null;
    setAsking(false);
  }, []);

  const chooseDestination =
    useCallback(async (): Promise<Destination | null> => {
      if (!supportsDirectoryPicker()) {
        return {kind: 'browser-download', browserIsReason: true};
      }
      const songsFolder = await getCachedSongsDirectoryHandle();
      if (songsFolder) return {kind: 'songs-folder', songsFolder};
      if (readDownloadChoice()) {
        return {kind: 'browser-download', browserIsReason: false};
      }
      return await new Promise<Destination | null>(resolve => {
        answerRef.current = resolve;
        setAsking(true);
      });
    }, []);

  const announceDownload = useCallback((browserIsReason: boolean) => {
    const copy = {...SONGS_FOLDER_DOWNLOAD_COPY, browserIsReason};
    // The whole notice once; after that, only the part that still matters.
    const description = explainedRef.current
      ? browserIsReason
        ? browserReasonSentence(copy.folder)
        : copy.action
      : downloadFallbackText(copy);
    explainedRef.current = true;
    toast.success('Saved to your Downloads folder', {description});
  }, []);

  const install = useCallback(
    async (chart: FindMusicChart) => {
      const destination = await chooseDestination();
      if (destination == null) return;
      if (destination.kind === 'songs-folder' && readDownloadChoice()) {
        writeDownloadChoice(false);
        setPrefersDownload(false);
      }

      setStates(current => ({...current, [chart.md5]: 'working'}));
      try {
        const result = await downloadSong(
          chart.artist,
          chart.name,
          chart.charter,
          `https://files.enchor.us/${chart.md5}.sng`,
          destination.kind === 'songs-folder'
            ? {
                kind: 'folder',
                folder: await getSongsDownloadFolder(destination.songsFolder),
              }
            : {kind: 'browser-download'},
          {asSng: true, source: 'find_music', md5: chart.md5},
        );
        setStates(current => ({...current, [chart.md5]: result.status}));
        if (destination.kind === 'browser-download') {
          announceDownload(destination.browserIsReason);
        }
      } catch (error) {
        console.error('Failed to install chart', error);
        // An md5 says which chart without saying which song.
        Sentry.captureException(error, {tags: {chart_md5: chart.md5}});
        setStates(current => ({...current, [chart.md5]: 'error'}));
      }
    },
    [announceDownload, chooseDestination],
  );

  const selectSongsFolder = useCallback(() => {
    // Called straight from the click: the picker needs the user's gesture.
    pickSongsDirectory().then(
      songsFolder =>
        answer(songsFolder ? {kind: 'songs-folder', songsFolder} : null),
      (error: unknown) => {
        answer(null);
        toast.error(error instanceof Error ? error.message : String(error));
        Sentry.captureException(error);
      },
    );
  }, [answer]);

  const justDownload = useCallback(() => {
    writeDownloadChoice(true);
    setPrefersDownload(true);
    answer({kind: 'browser-download', browserIsReason: false});
  }, [answer]);

  const dialog = (
    <Dialog
      open={asking}
      onOpenChange={open => {
        if (!open) answer(null);
      }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install charts into your Songs folder?</DialogTitle>
          <DialogDescription>
            Select your Clone Hero or YARG Songs folder, and charts install into
            it directly. Or download each chart to your Downloads folder and
            move it yourself.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This choice is kept. To install into a folder later, pick your Songs
          folder on the Local Songs Folder card.
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={justDownload}>
            Just download
          </Button>
          <Button type="button" onClick={selectSongsFolder}>
            Select Songs folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return {
    install,
    states,
    dialog,
    /** What the button does when clicked, as far as the page can tell now. */
    saveMode:
      !canPickFolders || prefersDownload
        ? ('download' as const)
        : ('install' as const),
    /** Why a chart downloads, when the browser is the reason. */
    downloadReason: canPickFolders
      ? null
      : browserReasonSentence(SONGS_FOLDER_DOWNLOAD_COPY.folder),
  };
}
