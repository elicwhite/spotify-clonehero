/**
 * Browser Compatibility Layer for File System Access
 * Provides fallbacks for browsers that don't support File System Access API
 */

export type CompatibilityMode = 'native' | 'fallback' | 'unsupported';

export interface BrowserCapabilities {
  mode: CompatibilityMode;
  canReadDirectories: boolean;
  canWriteFiles: boolean;
  canDownloadFiles: boolean;
  supportsDirectoryPicker: boolean;
  supportsDragAndDrop: boolean;
}

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  file?: File;
  children?: FileEntry[];
}

// Detect browser capabilities
export function detectBrowserCapabilities(): BrowserCapabilities {
  const hasFileSystemAccess = 
    typeof window !== 'undefined' &&
    typeof window.showDirectoryPicker === 'function' &&
    typeof window.FileSystemDirectoryHandle !== 'undefined';

  const hasFileAPI = 
    typeof window !== 'undefined' &&
    typeof window.File !== 'undefined' &&
    typeof window.FileReader !== 'undefined';

  const hasDragAndDrop = 
    typeof window !== 'undefined' &&
    typeof window.DataTransfer !== 'undefined';

  if (hasFileSystemAccess) {
    return {
      mode: 'native',
      canReadDirectories: true,
      canWriteFiles: true,
      canDownloadFiles: true,
      supportsDirectoryPicker: true,
      supportsDragAndDrop: true,
    };
  } else if (hasFileAPI) {
    return {
      mode: 'fallback',
      canReadDirectories: true, // via drag & drop or file input
      canWriteFiles: false,     // can only download
      canDownloadFiles: true,
      supportsDirectoryPicker: false,
      supportsDragAndDrop: hasDragAndDrop,
    };
  } else {
    return {
      mode: 'unsupported',
      canReadDirectories: false,
      canWriteFiles: false,
      canDownloadFiles: false,
      supportsDirectoryPicker: false,
      supportsDragAndDrop: false,
    };
  }
}

// Fallback directory picker using file input with webkitdirectory
export async function showDirectoryPickerFallback(): Promise<FileEntry[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    
    const timeout = setTimeout(() => {
      reject(new Error('User canceled picker'));
    }, 60000); // 1 minute timeout

    input.onchange = (event) => {
      clearTimeout(timeout);
      const files = Array.from((event.target as HTMLInputElement).files || []);
      
      if (files.length === 0) {
        reject(new Error('User canceled picker'));
        return;
      }

      const fileTree = buildFileTree(files);
      resolve(fileTree);
    };

    input.oncancel = () => {
      clearTimeout(timeout);
      reject(new Error('User canceled picker'));
    };

    // Trigger the file picker
    input.click();
  });
}

// Build a file tree from flat file list
function buildFileTree(files: File[]): FileEntry[] {
  const tree: { [path: string]: FileEntry } = {};
  const roots: FileEntry[] = [];

  files.forEach(file => {
    const pathParts = file.webkitRelativePath.split('/');
    let currentPath = '';

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      
      if (!tree[currentPath]) {
        const isFile = i === pathParts.length - 1;
        const entry: FileEntry = {
          name: part,
          type: isFile ? 'file' : 'directory',
          ...(isFile && { file }),
          ...(!isFile && { children: [] })
        };
        
        tree[currentPath] = entry;
        
        if (parentPath && tree[parentPath]?.children) {
          tree[parentPath].children!.push(entry);
        } else if (i === 0) {
          roots.push(entry);
        }
      }
    }
  });

  return roots;
}

// Unified directory picker that uses native API or fallback
export async function showDirectoryPicker(): Promise<FileEntry[] | FileSystemDirectoryHandle> {
  const capabilities = detectBrowserCapabilities();
  
  if (capabilities.mode === 'native') {
    // Use native API
    try {
      const handle = await window.showDirectoryPicker({
        id: 'clone-hero-songs',
        mode: 'readwrite',
      });
      return handle;
    } catch (err) {
      throw new Error('User canceled picker');
    }
  } else if (capabilities.mode === 'fallback') {
    // Use fallback method
    return await showDirectoryPickerFallback();
  } else {
    throw new Error('Directory selection not supported in this browser');
  }
}

// Download file function that works across browsers
export function downloadFile(filename: string, content: Blob | string) {
  const blob = content instanceof Blob ? content : new Blob([content]);
  
  if (window.navigator && (window.navigator as any).msSaveBlob) {
    // IE/Edge legacy support
    (window.navigator as any).msSaveBlob(blob, filename);
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  // Clean up
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// Check if a file matches common chart file patterns
export function isChartFile(filename: string): boolean {
  const chartExtensions = ['.chart', '.mid', '.midi'];
  const lowerName = filename.toLowerCase();
  return chartExtensions.some(ext => lowerName.endsWith(ext));
}

// Check if a file is a song.ini file
export function isSongIniFile(filename: string): boolean {
  return filename.toLowerCase() === 'song.ini';
}

// Extract chart information from file tree (fallback scanning)
export async function scanChartsFromFileTree(fileTree: FileEntry[]): Promise<any[]> {
  const charts: any[] = [];
  
  async function scanDirectory(entries: FileEntry[], path: string = '') {
    for (const entry of entries) {
      if (entry.type === 'directory' && entry.children) {
        // Check if this directory contains chart files
        const hasChartFiles = entry.children.some(child => 
          child.type === 'file' && isChartFile(child.name)
        );
        
        const hasSongIni = entry.children.some(child =>
          child.type === 'file' && isSongIniFile(child.name)
        );

        if (hasChartFiles || hasSongIni) {
          // This looks like a chart directory
          const songIniFile = entry.children.find(child => 
            child.type === 'file' && isSongIniFile(child.name)
          );

          let songInfo = {
            artist: 'Unknown Artist',
            name: entry.name,
            charter: 'Unknown Charter',
            folder: `${path}${entry.name}`,
            hasChart: hasChartFiles,
            hasSongIni: !!songIniFile,
          };

          // Try to read song.ini if available
          if (songIniFile?.file) {
            try {
              const iniContent = await songIniFile.file.text();
              const parsedIni = parseSongIni(iniContent);
              songInfo = { ...songInfo, ...parsedIni };
            } catch (error) {
              console.warn('Error reading song.ini:', error);
            }
          }

          charts.push(songInfo);
        }
        
        // Recursively scan subdirectories
        await scanDirectory(entry.children, `${path}${entry.name}/`);
      }
    }
  }
  
  await scanDirectory(fileTree);
  return charts;
}

// Simple song.ini parser
function parseSongIni(content: string): Partial<any> {
  const lines = content.split('\n');
  const result: any = {};
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('[') && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        const cleanKey = key.trim().toLowerCase();
        
        if (cleanKey === 'artist') result.artist = value;
        else if (cleanKey === 'name') result.name = value;
        else if (cleanKey === 'charter') result.charter = value;
        else if (cleanKey === 'frets') result.charter = value; // Alternative charter field
      }
    }
  }
  
  return result;
}

// Create a compatibility wrapper for existing functions
export class FileSystemCompat {
  private capabilities: BrowserCapabilities;
  
  constructor() {
    this.capabilities = detectBrowserCapabilities();
  }

  getCapabilities(): BrowserCapabilities {
    return this.capabilities;
  }

  async selectDirectory(): Promise<FileEntry[] | FileSystemDirectoryHandle> {
    return await showDirectoryPicker();
  }

  canWriteFiles(): boolean {
    return this.capabilities.canWriteFiles;
  }

  canReadDirectories(): boolean {
    return this.capabilities.canReadDirectories;
  }

  downloadFile(filename: string, content: Blob | string) {
    return downloadFile(filename, content);
  }
}