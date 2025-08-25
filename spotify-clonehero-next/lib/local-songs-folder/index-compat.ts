import {set, get} from 'idb-keyval';
import filenamify from 'filenamify/browser';
import {sendGAEvent} from '@next/third-parties/google';

import {
  detectBrowserCapabilities,
  showDirectoryPicker,
  downloadFile,
  scanChartsFromFileTree,
  type FileEntry
} from '@/lib/browser-compat/FileSystemCompat';
import {SongAccumulator} from './scanLocalCharts';

// Storage key for fallback mode chart data
const FALLBACK_CHARTS_KEY = 'fallback-scanned-charts';
const FALLBACK_SCAN_TIME_KEY = 'fallback-scan-time';

export interface ScanResult {
  lastScanned: Date;
  installedCharts: SongAccumulator[];
  mode: 'native' | 'fallback';
}

/**
 * Enhanced directory picker that works across browsers
 */
export async function promptForSongsDirectoryCompat(): Promise<FileEntry[] | FileSystemDirectoryHandle> {
  const capabilities = detectBrowserCapabilities();
  
  if (capabilities.mode === 'unsupported') {
    throw new Error('File system access not supported in this browser');
  }

  try {
    const result = await showDirectoryPicker();
    return result;
  } catch (err: any) {
    if (err.message.includes('canceled')) {
      throw new Error('User canceled picker');
    }
    throw err;
  }
}

/**
 * Scan for installed charts with browser compatibility
 */
export async function scanForInstalledChartsCompat(
  callbackPerSong: () => void = () => {},
): Promise<ScanResult> {
  const capabilities = detectBrowserCapabilities();
  
  if (capabilities.mode === 'native') {
    // Use existing native implementation
    return await scanForInstalledChartsNative(callbackPerSong);
  } else if (capabilities.mode === 'fallback') {
    // Use fallback implementation
    return await scanForInstalledChartsFallback(callbackPerSong);
  } else {
    throw new Error('Chart scanning not supported in this browser');
  }
}

/**
 * Native implementation (existing logic)
 */
async function scanForInstalledChartsNative(
  callbackPerSong: () => void
): Promise<ScanResult> {
  const root = await navigator.storage.getDirectory();
  
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await (window as any).showDirectoryPicker({
      id: 'clone-hero-songs',
      mode: 'readwrite',
    });
  } catch (err) {
    throw new Error('User canceled picker');
  }

  await set('songsDirectoryHandle', handle);

  const beforeScan = Date.now();
  const installedCharts: SongAccumulator[] = [];
  
  // Import the scanLocalCharts function
  const { default: scanLocalCharts } = await import('./scanLocalCharts');
  await scanLocalCharts(handle, installedCharts, callbackPerSong);
  
  console.log(
    'Took',
    (Date.now() - beforeScan) / 1000,
    'ss to scan',
    installedCharts.length,
  );

  sendGAEvent({
    event: 'charts_scanned',
    value: installedCharts.length,
  });

  // Cache results
  const installedChartsCacheHandle = await root.getFileHandle(
    'installedCharts.json',
    { create: true }
  );
  
  const writableStream = await installedChartsCacheHandle.createWritable();
  await writableStream.write(JSON.stringify(installedCharts));
  await writableStream.close();
  
  const now = new Date();
  localStorage.setItem(
    'lastScannedInstalledCharts',
    now.getTime().toString(),
  );

  return {
    lastScanned: now,
    installedCharts,
    mode: 'native'
  };
}

/**
 * Fallback implementation for browsers without File System Access API
 */
async function scanForInstalledChartsFallback(
  callbackPerSong: () => void
): Promise<ScanResult> {
  // Show instructions to user
  alert(
    'Your browser doesn\'t support native directory access. ' +
    'Please select your Clone Hero Songs folder in the file picker dialog. ' +
    'Make sure to select the entire folder structure.'
  );

  const fileTree = await showDirectoryPicker() as FileEntry[];
  
  if (!Array.isArray(fileTree)) {
    throw new Error('Expected file tree array in fallback mode');
  }

  const beforeScan = Date.now();
  
  // Scan the file tree for charts
  const charts = await scanChartsFromFileTree(fileTree);
  
  // Convert to SongAccumulator format
  const installedCharts: SongAccumulator[] = charts.map((chart, index) => {
    callbackPerSong(); // Call progress callback
    
    return {
      artist: chart.artist || 'Unknown Artist',
      song: chart.name || 'Unknown Song',
      charter: chart.charter || 'Unknown Charter',
      folder: chart.folder || '',
      hasChart: chart.hasChart || false,
      hasSongIni: chart.hasSongIni || false,
      // Add other required fields with defaults
      avoidedFolders: 0,
      filesScanned: 1,
      songsScanned: 1,
    };
  });

  console.log(
    'Took',
    (Date.now() - beforeScan) / 1000,
    'ss to scan',
    installedCharts.length,
    'charts in fallback mode'
  );

  sendGAEvent({
    event: 'charts_scanned_fallback',
    value: installedCharts.length,
  });

  // Cache results in localStorage/IndexedDB
  await set(FALLBACK_CHARTS_KEY, installedCharts);
  
  const now = new Date();
  await set(FALLBACK_SCAN_TIME_KEY, now.getTime());

  return {
    lastScanned: now,
    installedCharts,
    mode: 'fallback'
  };
}

/**
 * Download song with browser compatibility
 */
export async function downloadSongCompat(
  artist: string,
  song: string,
  charter: string,
  url: string,
  options?: {
    replaceExisting?: boolean;
    asSng?: boolean;
  },
): Promise<{success: boolean; filename: string; mode: 'native' | 'fallback'}> {
  const capabilities = detectBrowserCapabilities();
  
  sendGAEvent({
    event: 'download_song_compat',
    value: capabilities.mode,
  });

  if (capabilities.mode === 'native') {
    // Use existing native implementation
    const { downloadSong } = await import('./index');
    try {
      const result = await downloadSong(artist, song, charter, url, options);
      return {
        success: !!result,
        filename: result?.fileName || '',
        mode: 'native'
      };
    } catch (error) {
      console.error('Native download failed:', error);
      throw error;
    }
  } else {
    // Use fallback download
    return await downloadSongFallback(artist, song, charter, url, options);
  }
}

/**
 * Fallback download implementation
 */
async function downloadSongFallback(
  artist: string,
  song: string,
  charter: string,
  url: string,
  options?: {
    replaceExisting?: boolean;
    asSng?: boolean;
  },
): Promise<{success: boolean; filename: string; mode: 'fallback'}> {
  try {
    const response = await fetch(url, {
      headers: {
        accept: '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'sec-fetch-dest': 'empty',
      },
      referrerPolicy: 'no-referrer',
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const blob = await response.blob();
    const artistSongTitle = `${artist} - ${song} (${charter})${
      options?.asSng ? '.sng' : '.zip'
    }`;
    const filename = filenamify(artistSongTitle, {replacement: ''});

    // Download file using browser's download mechanism
    downloadFile(filename, blob);

    console.log(`Downloaded ${filename} using fallback method`);
    
    return {
      success: true,
      filename,
      mode: 'fallback'
    };
  } catch (error) {
    console.error('Fallback download failed:', error);
    throw error;
  }
}

/**
 * Get cached scan results for fallback mode
 */
export async function getCachedScanResults(): Promise<ScanResult | null> {
  const capabilities = detectBrowserCapabilities();
  
  if (capabilities.mode === 'fallback') {
    const charts = await get(FALLBACK_CHARTS_KEY);
    const scanTime = await get(FALLBACK_SCAN_TIME_KEY);
    
    if (charts && scanTime) {
      return {
        lastScanned: new Date(scanTime),
        installedCharts: charts,
        mode: 'fallback'
      };
    }
  }
  
  return null;
}

/**
 * Check if browser supports chart scanning
 */
export function canScanCharts(): boolean {
  const capabilities = detectBrowserCapabilities();
  return capabilities.canReadDirectories;
}

/**
 * Check if browser supports file downloads
 */
export function canDownloadFiles(): boolean {
  const capabilities = detectBrowserCapabilities();
  return capabilities.canDownloadFiles;
}