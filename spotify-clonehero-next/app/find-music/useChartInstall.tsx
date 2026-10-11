'use client';

import * as Sentry from '@sentry/nextjs';
import {useCallback, useRef, useState, useSyncExternalStore} from 'react';
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
import {
  prefersBrowserDownload,
  setPrefersBrowserDownload,
  subscribeToDownloadChoice,
} from '@/lib/local-songs-folder/downloadChoice';
import {SONGS_FOLDER_DOWNLOAD_COPY} from './songsFolderCopy';
import type {FindMusicChart} from './types';

export type ChartInstallState =
  | 'idle'
  | 'working'
  | 'installed'
  | 'downloaded'
  | 'error';

type Destination =
  | {kind: 'songs-folder'; songsFolder: FileSystemDirectoryHandle}
  | {kind: 'browser-download'; browserIsReason: boolean};

const serverPrefersDownload = () => false;

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
 * Picking a Songs folder clears a stored "Just download"
 * (`pickSongsDirectory` does it), so the two can never disagree.
 */
export function useChartInstall() {
  const canPickFolders = useSupportsDirectoryPicker();
  const prefersDownload = useSyncExternalStore(
    subscribeToDownloadChoice,
    prefersBrowserDownload,
    serverPrefersDownload,
  );
  const [states, setStates] = useState<Record<string, ChartInstallState>>({});
  // The chart whose Install opened the dialog. The dialog is open while set.
  const [askingFor, setAskingFor] = useState<FindMusicChart | null>(null);
  const explainedRef = useRef(false);

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

  const installTo = useCallback(
    async (chart: FindMusicChart, destination: Destination) => {
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
          {source: 'find_music', md5: chart.md5},
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
    [announceDownload],
  );

  const install = useCallback(
    async (chart: FindMusicChart) => {
      if (!supportsDirectoryPicker()) {
        return await installTo(chart, {
          kind: 'browser-download',
          browserIsReason: true,
        });
      }
      const songsFolder = await getCachedSongsDirectoryHandle();
      if (songsFolder) {
        return await installTo(chart, {kind: 'songs-folder', songsFolder});
      }
      if (prefersBrowserDownload()) {
        return await installTo(chart, {
          kind: 'browser-download',
          browserIsReason: false,
        });
      }
      setAskingFor(chart);
    },
    [installTo],
  );

  const selectSongsFolder = useCallback(() => {
    const chart = askingFor;
    setAskingFor(null);
    if (chart == null) return;
    // Called straight from the click: the picker needs the user's gesture.
    pickSongsDirectory().then(
      songsFolder => {
        if (songsFolder) {
          void installTo(chart, {kind: 'songs-folder', songsFolder});
        }
      },
      (error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error));
        Sentry.captureException(error);
      },
    );
  }, [askingFor, installTo]);

  const justDownload = useCallback(() => {
    const chart = askingFor;
    setAskingFor(null);
    if (chart == null) return;
    setPrefersBrowserDownload(true);
    void installTo(chart, {kind: 'browser-download', browserIsReason: false});
  }, [askingFor, installTo]);

  const dialog = (
    <Dialog
      open={askingFor != null}
      onOpenChange={open => {
        if (!open) setAskingFor(null);
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
    /** What the button does when clicked. */
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
