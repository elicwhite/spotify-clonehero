'use client';

import {useEffect} from 'react';
import {runRawSql} from '@/lib/local-db/client';

/**
 * Registers WebMCP tools for OPFS inspection via navigator.modelContext.
 * These tools are callable from Claude Code via evaluate_script + navigator.modelContextTesting.executeTool().
 * Renders nothing — this is a side-effect-only component.
 */
export default function WebMCPTools() {
  useEffect(() => {
    if (
      !navigator.modelContext ||
      typeof navigator.modelContext.registerTool !== 'function'
    ) {
      return;
    }

    navigator.modelContext.registerTool({
      name: 'opfs_list',
      description:
        'List all files in OPFS, or files under a specific path. Returns file tree with sizes and modification dates.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Optional subdirectory path to list (e.g. "drum-transcription" or "drum-transcription/my-song/stems"). Omit for root.',
          },
        },
      },
      execute: async (args: Record<string, unknown>) => {
        const path = (args.path as string) || '';

        async function listDir(
          dir: FileSystemDirectoryHandle,
          prefix: string,
        ): Promise<
          Array<{
            path: string;
            kind: string;
            size?: number;
            sizeHuman?: string;
            lastModified?: string;
          }>
        > {
          const entries: Array<{
            path: string;
            kind: string;
            size?: number;
            sizeHuman?: string;
            lastModified?: string;
          }> = [];
          for await (const [name, handle] of dir) {
            const fullPath = prefix ? `${prefix}/${name}` : name;
            if (handle.kind === 'directory') {
              entries.push({path: fullPath, kind: 'directory'});
              const subDir = await dir.getDirectoryHandle(name);
              entries.push(...(await listDir(subDir, fullPath)));
            } else {
              const file = await (handle as FileSystemFileHandle).getFile();
              entries.push({
                path: fullPath,
                kind: 'file',
                size: file.size,
                sizeHuman:
                  file.size > 1048576
                    ? (file.size / 1048576).toFixed(1) + ' MB'
                    : (file.size / 1024).toFixed(1) + ' KB',
                lastModified: new Date(file.lastModified).toISOString(),
              });
            }
          }
          return entries;
        }

        try {
          let dir: FileSystemDirectoryHandle =
            await navigator.storage.getDirectory();
          if (path) {
            for (const part of path.split('/').filter(Boolean)) {
              dir = await dir.getDirectoryHandle(part);
            }
          }
          const entries = await listDir(dir, path);
          return {
            content: [{type: 'text', text: JSON.stringify(entries, null, 2)}],
          };
        } catch (e) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: `Path not found: ${path}`,
                  message: String(e),
                }),
              },
            ],
          };
        }
      },
    });

    navigator.modelContext.registerTool({
      name: 'opfs_read_text',
      description:
        'Read a text file from OPFS (JSON, .chart, .ini, etc). Returns the file content as text.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Full path to the file (e.g. "drum-transcription/my-song/chart/notes.chart")',
          },
          maxLines: {
            type: 'number',
            description:
              'Maximum number of lines to return. Omit for full file.',
          },
        },
        required: ['path'],
      },
      execute: async (args: Record<string, unknown>) => {
        const path = args.path as string;
        const maxLines = args.maxLines as number | undefined;

        try {
          const parts = path.split('/').filter(Boolean);
          const fileName = parts.pop()!;
          let dir: FileSystemDirectoryHandle =
            await navigator.storage.getDirectory();
          for (const part of parts) {
            dir = await dir.getDirectoryHandle(part);
          }
          const handle = await dir.getFileHandle(fileName);
          const file = await handle.getFile();
          let text = await file.text();
          if (maxLines) {
            text = text.split('\n').slice(0, maxLines).join('\n');
          }
          return {content: [{type: 'text', text}]};
        } catch (e) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: `Cannot read: ${path}`,
                  message: String(e),
                }),
              },
            ],
          };
        }
      },
    });

    navigator.modelContext.registerTool({
      name: 'opfs_pcm_info',
      description:
        'Get info about PCM audio files in an OPFS directory (size, duration). PCM files are Float32 interleaved stereo at 44100 Hz.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Path to directory containing PCM files (e.g. "drum-transcription/my-song/stems")',
          },
        },
        required: ['path'],
      },
      execute: async (args: Record<string, unknown>) => {
        const path = args.path as string;

        try {
          const parts = path.split('/').filter(Boolean);
          let dir: FileSystemDirectoryHandle =
            await navigator.storage.getDirectory();
          for (const part of parts) {
            dir = await dir.getDirectoryHandle(part);
          }
          const entries: Array<{
            name: string;
            sizeMB: string;
            durationSec: string;
            durationFormatted: string;
          }> = [];
          for await (const [name, handle] of dir) {
            if (handle.kind === 'file') {
              const file = await (handle as FileSystemFileHandle).getFile();
              const samples = file.size / 4;
              const durationSec = samples / 2 / 44100;
              entries.push({
                name,
                sizeMB: (file.size / 1048576).toFixed(1),
                durationSec: durationSec.toFixed(1),
                durationFormatted: `${Math.floor(durationSec / 60)}:${(durationSec % 60).toFixed(0).padStart(2, '0')}`,
              });
            }
          }
          return {
            content: [{type: 'text', text: JSON.stringify(entries, null, 2)}],
          };
        } catch (e) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: `Cannot read: ${path}`,
                  message: String(e),
                }),
              },
            ],
          };
        }
      },
    });

    navigator.modelContext.registerTool({
      name: 'opfs_storage_quota',
      description: 'Check how much OPFS storage space is used and available.',
      inputSchema: {type: 'object', properties: {}},
      execute: async () => {
        const estimate = await navigator.storage.estimate();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                used: ((estimate.usage ?? 0) / 1048576).toFixed(1) + ' MB',
                quota: ((estimate.quota ?? 0) / 1048576).toFixed(0) + ' MB',
                percent:
                  (
                    ((estimate.usage ?? 0) / (estimate.quota ?? 1)) *
                    100
                  ).toFixed(1) + '%',
              }),
            },
          ],
        };
      },
    });

    navigator.modelContext.registerTool({
      name: 'opfs_delete',
      description:
        'Delete a file or directory from OPFS. Use with caution — this is not reversible.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Path to delete (e.g. "drum-transcription/my-song" to delete a project)',
          },
        },
        required: ['path'],
      },
      execute: async (args: Record<string, unknown>) => {
        const path = args.path as string;

        try {
          const parts = path.split('/').filter(Boolean);
          const target = parts.pop()!;
          let dir: FileSystemDirectoryHandle =
            await navigator.storage.getDirectory();
          for (const part of parts) {
            dir = await dir.getDirectoryHandle(part);
          }
          await dir.removeEntry(target, {recursive: true});
          return {
            content: [{type: 'text', text: `Deleted: ${path}`}],
          };
        } catch (e) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: `Cannot delete: ${path}`,
                  message: String(e),
                }),
              },
            ],
          };
        }
      },
    });

    navigator.modelContext.registerTool({
      name: 'run_sql',
      description:
        'Run a raw SQL query against the local SQLocal SQLite database. Returns rows as JSON.',
      inputSchema: {
        type: 'object',
        properties: {
          sql: {
            type: 'string',
            description: 'SQL query to execute',
          },
        },
        required: ['sql'],
      },
      execute: async (args: Record<string, unknown>) => {
        const sql = args.sql as string;
        try {
          const rows = await runRawSql(sql);
          return {
            content: [{type: 'text', text: JSON.stringify(rows, null, 2)}],
          };
        } catch (e) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'SQL query failed',
                  message: String(e),
                }),
              },
            ],
          };
        }
      },
    });
  }, []);

  return null;
}
