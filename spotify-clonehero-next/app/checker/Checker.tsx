'use client';

import {useCallback, useEffect, useState} from 'react';
import Bottleneck from 'bottleneck'
import {ScannedChart, scanChartFolder} from 'scan-chart';
import {getChartIssues, getIssuesXLSX} from './ExcelBuilder';
import {calculateTimeRemaining, formatTimeRemaining} from '@/lib/ui-utils';
import {Button} from '@/components/ui/button';
import SupportedBrowserWarning from '../SupportedBrowserWarning';
import _ from 'lodash';
import { SngHeader, SngStream } from 'parse-sng';

export default function CheckerPage() {
  const [keyId, setKeyId] = useState<number>(0);
  const [directoryHandle, setDirectoryHandle] =
    useState<FileSystemDirectoryHandle | null>(null);

  const handler = useCallback(async () => {
    let handle;

    try {
      handle = await window.showDirectoryPicker({
        id: 'charts-to-scan',
      });
    } catch {
      console.log('User canceled picker');
      return;
    }

    setDirectoryHandle(handle);
    setKeyId(key => key + 1);
  }, []);

  return (
    <>
      <p className="mb-4 text-center">
        This tool will scan charts in a folder on your computer,
        <br /> providing an Excel file with all the issues found.
        <br />
      </p>
      <SupportedBrowserWarning>
        <Button onClick={handler}>Choose Folder</Button>

        {directoryHandle == null ? null : (
          <Scanner key={keyId} directoryHandle={directoryHandle} />
        )}
      </SupportedBrowserWarning>
    </>
  );
}

function Scanner({
  directoryHandle,
}: {
  directoryHandle: FileSystemDirectoryHandle;
}) {
  const [numFolders, setNumFolders] = useState<number | null>(null);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [counter, setCounter] = useState<number>(0);
  const [latestChart, setLatestChart] = useState<string | null>(null);
  const [xlsx, setXlsx] = useState<ArrayBuffer | null>(null);
  const [issuesFound, setIssuesFound] = useState<number | null>(null);

  useEffect(() => {
    let isCanceled = false;
    async function run() {
      const charts = await scanChartsFolder(directoryHandle, {
        onFolders: count => {
          setNumFolders(count);
        },
        onChart: chart => {
          // Only set this if it isn't already set
          setStartTime(d => (d == null ? new Date() : d));

          setCounter(c => (c == null ? 0 : c + 1));
          setLatestChart(chart.path);
        }
      }, () => isCanceled);

      const issues = await getChartIssues(charts);
      const xlsx = await getIssuesXLSX(issues);
      setIssuesFound(issues.length);
      setXlsx(xlsx);
    }
    run();
    return () => {
      // cleanup
      isCanceled = true;
      setNumFolders(null);
      setCounter(0);
      setLatestChart(null);
    }
  }, [directoryHandle]);

  const downloadXlsx = useCallback(async () => {
    if (xlsx == null) {
      throw new Error(
        'Cannot download the excel file. It has not been created yet',
      );
    }

    const fileHandle = await window.showSaveFilePicker({
      id: 'download-excel',
      startIn: 'downloads',
      suggestedName: `Chart-Errors-${new Date().toISOString()}.xlsx`,
      types: [
        {
          accept: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
              ['.xlsx'],
          },
        },
      ],
    });

    const writableStream = await fileHandle.createWritable();
    await writableStream.write(xlsx);
    await writableStream.close();
  }, [xlsx]);

  let timeRemaining;
  // Calculate time remaining
  if (startTime && numFolders) {
    timeRemaining = calculateTimeRemaining(startTime, numFolders, counter, 500);
  }

  return (
    <>
      {numFolders == null ? null : (
        <>
          <h1>
            Scanned {counter} out of {numFolders} charts
          </h1>
        </>
      )}
      {latestChart != null && xlsx == null ? (
        <>
          <h1>Currently Scanning {latestChart}</h1>
          {timeRemaining != null && (
            <h1>{formatTimeRemaining(timeRemaining)}</h1>
          )}
        </>
      ) : null}
      {issuesFound == null ? null : <h1>{issuesFound} issues Found</h1>}
      {xlsx == null ? null : (
        <Button onClick={downloadXlsx}>Download Excel File of Issues</Button>
      )}
    </>
  );
}

/**
 * Scans the charts in `chartsFolder` and its subfolders.
 */
async function scanChartsFolder(
  chartsFolder: FileSystemDirectoryHandle,
  listeners: {
    onFolders: (folderCount: number) => void,
    onChart: (chart: { chart: ScannedChart; path: string }) => void
  },
  isCanceled: () => boolean) {
  const chartFolders = await getChartFolders(chartsFolder.name, chartsFolder);
  listeners.onFolders(chartFolders.length);

  if (chartFolders.length == 0) {
    return [];
  }

  const limiter = new Bottleneck({ maxConcurrent: 20 }); // Ensures memory use stays bounded

  const charts: { chart: ScannedChart; path: string }[] = [];
  for (const chartFolder of chartFolders) {
    if (isCanceled()) {
      return [];
    }
    limiter.schedule(async () => {
      const isSng = chartFolder.files.length === 1 && hasSngExtension(chartFolder.files[0].name);
      const files = isSng ? await getFilesFromSng(chartFolder.files[0]) : await getFilesFromFolder(chartFolder.files);

			const result: { chart: ScannedChart; path: string } = {
				chart: scanChartFolder(files),
				path: chartFolder.path,
			};
			charts.push(result);
      listeners.onChart(result);
    });
  }

	return new Promise<{ chart: ScannedChart; path: string }[]>((resolve, reject) => {
		limiter.on('error', err => {
			reject(err);
			limiter.stop();
		});

		limiter.on('idle', () => {
			resolve(charts);
		});
	});
}

/**
 * @returns valid chart folders in `path` and all its subdirectories.
 */
async function getChartFolders(path: string, directoryHandle: FileSystemDirectoryHandle) {
  const chartFolders: { path: string; files: FileSystemFileHandle[] }[] = [];

  const files: (FileSystemDirectoryHandle | FileSystemFileHandle)[] = [];
  for await (const subHandle of directoryHandle.values()) {
    files.push(subHandle);
  }

  const subfolders = _.chain(files)
    .filter((f): f is FileSystemDirectoryHandle => f.kind == 'directory' && f.name !== '__MACOSX') // Apple should follow the principle of least astonishment (smh)
    .map(f => getChartFolders([path, f.name].join('/'), f))
    .value();

  chartFolders.push(..._.flatMap(await Promise.all(subfolders)));

  const sngFiles = files.filter((f): f is FileSystemFileHandle => f.kind != 'directory' && hasSngExtension(f.name));
  chartFolders.push(...sngFiles.map(sf => ({ path, files: [sf] })));

  if (
    appearsToBeChartFolder(files.map(file => getExtension(file.name).substring(1))) &&
    subfolders.length === 0 // Charts won't contain other charts
  ) {
    chartFolders.push({
      path,
      files: files.filter((f): f is FileSystemFileHandle => f.kind != 'directory'),
    });
  }

  return chartFolders;
}

async function getFilesFromFolder(fileHandles: FileSystemFileHandle[]): Promise<{ fileName: string; data: Uint8Array }[]> {
	const files = await Promise.all(fileHandles.map(async fileHandle => await fileHandle.getFile()));

	const isFileTruncated = (file: File) => {
		const MAX_FILE_MIB = 2048;
		const MAX_FILES_MIB = 5000;
		const sortedFiles = _.sortBy(files, f => f.size);
		let usedSizeMib = 0;
		for (const sortedFile of sortedFiles) {
			usedSizeMib += Number(sortedFile.size / 1024 / 1024);
			if (sortedFile === file) {
				return usedSizeMib > MAX_FILES_MIB || file.size / 1024 / 1024 >= MAX_FILE_MIB;
			}
		}
	}

	return await Promise.all(
		files.map(async file => {
			if (isFileTruncated(file) || hasVideoExtension(file.name)) {
				return { fileName: file.name, data: new Uint8Array() };
			} else {
				return { fileName: file.name, data: new Uint8Array(await file.arrayBuffer()) };
			}
		}),
	)
}

async function getFilesFromSng(sngFileHandle: FileSystemFileHandle) {
	const file = await sngFileHandle.getFile();
  const sngStream = new SngStream(() => file.stream(), { generateSongIni: true });

  let header: SngHeader;
  sngStream.on('header', h => header = h);
  const isFileTruncated = (fileName: string) => {
		const MAX_FILE_MIB = 2048;
		const MAX_FILES_MIB = 5000;
		const sortedFiles = _.sortBy(header.fileMeta, f => f.contentsLen);
		let usedSizeMib = 0;
		for (const sortedFile of sortedFiles) {
			usedSizeMib += Number(sortedFile.contentsLen / BigInt(1024) / BigInt(1024));
			if (sortedFile.filename === fileName) {
				return usedSizeMib > MAX_FILES_MIB || sortedFile.contentsLen / BigInt(1024) / BigInt(1024) >= MAX_FILE_MIB;
			}
		}
	}


  const files: { fileName: string, data: Uint8Array }[] = [];

  sngStream.on('file', async (fileName, fileStream) => {
    const matchingFileMeta = header.fileMeta.find(f => f.filename === fileName);
    if (hasVideoExtension(fileName) || isFileTruncated(fileName) || !matchingFileMeta) {
      const reader = fileStream.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await reader.read();
        if (result.done) {
          break;
        }
      }
    } else {
      const data = new Uint8Array(Number(matchingFileMeta.contentsLen));
      let offset = 0;
      const reader = fileStream.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await reader.read();
        if (result.done) {
          break;
        }
        data.set(result.value, offset);
        offset += result.value.length;
      }

      files.push({ fileName, data });
    }
  })

  await new Promise<void>((resolve, reject) => {
    sngStream.on('end', () => resolve());

    sngStream.on('error', error => reject(error));

    sngStream.start();
  })

  return files;
}

/**
 * @returns `true` if `name` has a valid sng file extension.
 */
export function hasSngExtension(name: string) {
	return '.sng' === getExtension(name).toLowerCase();
}
/**
 * @returns `true` if `name` is a valid video file extension.
 */
export function hasVideoExtension(name: string) {
	return ['.mp4', '.avi', '.webm', '.ogv', '.mpeg'].includes(getExtension(name).toLowerCase());
}
/**
 * @returns extension of a file, including the dot. (e.g. "song.ogg" -> ".ogg")
 */
export function getExtension(fileName: string) {
	return '.' + fileName.split('.').pop()!;
}
/**
 * @returns true if the list of filename `extensions` appears to be intended as a chart folder.
 */
export function appearsToBeChartFolder(extensions: string[]) {
	const ext = extensions.map(extension => extension.toLowerCase());
	const containsNotes = (ext.includes('chart') || ext.includes('mid'));
	const containsAudio = (ext.includes('ogg') || ext.includes('mp3') || ext.includes('wav') || ext.includes('opus'));
	return (containsNotes || containsAudio);
}