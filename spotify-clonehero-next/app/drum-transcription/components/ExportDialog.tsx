'use client';

import {useState, useCallback} from 'react';
import {Download, Loader2} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {Label} from '@/components/ui/label';
import {Switch} from '@/components/ui/switch';

import {encodeWav} from '@/lib/drum-transcription/audio/wav-encoder';
import {serializeSongIni} from '@/lib/drum-transcription/chart-io/song-ini';
import type {SongMetadata} from '@/lib/drum-transcription/chart-io/song-ini';
import {exportAsZip, exportAsSng} from '@/lib/chart-export';
import {
  readProjectText,
  readProjectBinary,
  projectFileExists,
  loadAudioMeta,
} from '@/lib/drum-transcription/storage/opfs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportDialogProps {
  /** Project ID for OPFS lookups. */
  projectId: string;
  /** Song name for display and metadata. */
  songName: string;
  /** Artist name for metadata. */
  artistName?: string;
}

type AudioFormat = 'wav';
type PackageFormat = 'zip' | 'sng';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Export dialog for downloading the chart as a .zip or .sng package.
 *
 * Allows the user to select package format (ZIP or SNG), audio format,
 * and choose which audio stems to include. Reads chart and audio data
 * from OPFS, packages them, and triggers a browser download.
 */
export default function ExportDialog({
  projectId,
  songName,
  artistName,
}: ExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [packageFormat, setPackageFormat] = useState<PackageFormat>('zip');
  const [audioFormat, setAudioFormat] = useState<AudioFormat>('wav');
  const [includeDrumStem, setIncludeDrumStem] = useState(true);
  const [includeAccompaniment, setIncludeAccompaniment] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      // 1. Read the chart — prefer edited version, fall back to generated
      let chartText: string;
      const hasEdited = await projectFileExists(
        projectId,
        'notes.edited.chart',
      );
      if (hasEdited) {
        chartText = await readProjectText(projectId, 'notes.edited.chart');
      } else {
        chartText = await readProjectText(projectId, 'notes.chart');
      }

      // 2. Load audio metadata
      const audioMeta = await loadAudioMeta(projectId);

      // 3. Build song.ini
      const songMetadata: SongMetadata = {
        name: songName,
        artist: artistName ?? '',
        durationMs: audioMeta.durationMs,
      };
      const songIni = serializeSongIni(songMetadata);

      // 4. Encode audio stems as WAV
      const audioFiles = new Map<string, ArrayBuffer>();

      if (includeDrumStem) {
        try {
          const drumsPcmBuffer = await readProjectBinary(projectId, 'drums.pcm');
          const drumsPcm = new Float32Array(drumsPcmBuffer);
          const drumsWav = encodeWav(
            drumsPcm,
            audioMeta.sampleRate,
            audioMeta.channels,
          );
          audioFiles.set('drums.wav', drumsWav);
        } catch {
          toast.error('Drum stem not found — skipping drums.wav');
        }
      }

      if (includeAccompaniment) {
        // Build accompaniment from bass + other + vocals stems, or fall back to full mix
        try {
          const stemNames = ['bass', 'other', 'vocals'];
          const stemBuffers: Float32Array[] = [];

          for (const stemName of stemNames) {
            try {
              const buffer = await readProjectBinary(projectId, `${stemName}.pcm`);
              stemBuffers.push(new Float32Array(buffer));
            } catch {
              // Stem not available
            }
          }

          if (stemBuffers.length > 0) {
            // Mix stems together
            const maxLength = Math.max(...stemBuffers.map(b => b.length));
            const mixed = new Float32Array(maxLength);
            for (const stem of stemBuffers) {
              for (let i = 0; i < stem.length; i++) {
                mixed[i] += stem[i];
              }
            }
            // Clamp to [-1, 1]
            for (let i = 0; i < mixed.length; i++) {
              mixed[i] = Math.max(-1, Math.min(1, mixed[i]));
            }
            const songWav = encodeWav(
              mixed,
              audioMeta.sampleRate,
              audioMeta.channels,
            );
            audioFiles.set('song.wav', songWav);
          } else {
            // Fall back to full mix
            const fullPcmBuffer = await readProjectBinary(projectId, 'full.pcm');
            const fullPcm = new Float32Array(fullPcmBuffer);
            const songWav = encodeWav(
              fullPcm,
              audioMeta.sampleRate,
              audioMeta.channels,
            );
            audioFiles.set('song.wav', songWav);
          }
        } catch {
          toast.error('Could not create accompaniment audio — skipping song.wav');
        }
      }

      // 5. Build file entries and package as ZIP or SNG
      const encoder = new TextEncoder();
      const fileEntries = [
        {filename: 'notes.chart', data: encoder.encode(chartText)},
        {filename: 'song.ini', data: encoder.encode(songIni)},
      ];
      for (const [name, data] of audioFiles) {
        fileEntries.push({filename: name, data: new Uint8Array(data)});
      }

      let blob: Blob;
      let extension: string;

      if (packageFormat === 'sng') {
        // exportAsSng extracts song.ini into SNG header metadata automatically
        const sngBytes = exportAsSng(fileEntries);
        blob = new Blob([sngBytes], {type: 'application/octet-stream'});
        extension = 'sng';
      } else {
        blob = exportAsZip(fileEntries);
        extension = 'zip';
      }

      // 6. Trigger browser download
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${songName.replace(/[^a-zA-Z0-9_-]/g, '_')}.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      toast.success('Chart exported successfully');
      setOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      console.error('Export error:', err);
      toast.error(msg);
    } finally {
      setIsExporting(false);
    }
  }, [
    projectId,
    songName,
    artistName,
    packageFormat,
    audioFormat,
    includeDrumStem,
    includeAccompaniment,
  ]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4 mr-1" />
          Export
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export Chart</DialogTitle>
          <DialogDescription>
            {songName}
            {artistName ? ` - ${artistName}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Package format selector */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="package-format" className="text-right">
              Format
            </Label>
            <Select
              value={packageFormat}
              onValueChange={v => setPackageFormat(v as PackageFormat)}>
              <SelectTrigger className="col-span-3" id="package-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zip">ZIP (standard)</SelectItem>
                <SelectItem value="sng">SNG (Clone Hero / YARG)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Audio format selector */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="audio-format" className="text-right">
              Audio
            </Label>
            <Select
              value={audioFormat}
              onValueChange={v => setAudioFormat(v as AudioFormat)}>
              <SelectTrigger className="col-span-3" id="audio-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="wav">WAV (lossless)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Include checkboxes */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Include</Label>
            <div className="col-span-3 space-y-3">
              <div className="flex items-center gap-2">
                <Switch
                  id="include-drums"
                  checked={includeDrumStem}
                  onCheckedChange={setIncludeDrumStem}
                />
                <Label htmlFor="include-drums" className="font-normal">
                  Drum stem (drums.wav)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="include-accompaniment"
                  checked={includeAccompaniment}
                  onCheckedChange={setIncludeAccompaniment}
                />
                <Label htmlFor="include-accompaniment" className="font-normal">
                  Accompaniment (song.wav)
                </Label>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-1" />
                Download .{packageFormat}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
