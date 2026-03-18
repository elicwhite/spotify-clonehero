# 0009 - Chart Export Packaging (.zip)

> **Dependencies:** 0002 (chart writing), 0007 (editor provides the finalized chart)
> **Unlocks:** Complete end-to-end pipeline
>
> **Integration:** Export code in `lib/drum-transcription/export/`. INI writing in `lib/drum-transcription/chart-io/song-ini.ts` (reading already exists in `lib/ini-parser.ts`). WAV encoder in `lib/drum-transcription/audio/wav-encoder.ts`. ZIP via `fflate` (new dependency). Tests in `lib/drum-transcription/__tests__/export.test.ts` using Jest (existing test setup). UI in `app/drum-transcription/components/ExportDialog.tsx` using shadcn `Dialog`, `Select`, `Button`.

## Overview

The final output isn't a standalone `.chart` file — it's a **packaged archive** containing the chart, audio stems, and metadata. The `.zip` format is the standard chart distribution format. The exported zip must produce output that `scan-chart`'s `scanChartFolder` can read back.

The complete spec for the chart zip format can be found at `~/projects/GuitarGame_ChartFormats`, which also contains a CLI tool with logic for how to create these files.

Reference `~/projects/Moonscraper-Chart-Editor` for how Moonscraper writes chart packages.

---

## 1. Package Contents

| File | Required | Description |
|------|----------|-------------|
| `notes.chart` | Yes | The drum chart |
| `song.ini` | Yes | Clone Hero metadata |
| `drums.wav` (or `.ogg`) | Yes | Drum stem audio |
| `song.wav` (or `.ogg`) | Yes | Full mix or accompaniment |
| `album.png` | No | Album art |

---

## 2. song.ini Format

Clone Hero uses a `song.ini` file with INI format:

```ini
[song]
name = Song Title
artist = Artist Name
album =
genre =
year =
charter = AutoDrums
diff_drums = -1
preview_start_time = 0
song_length = 240000
delay = 0
pro_drums = True
```

### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Song name |
| `artist` | string | Artist name |
| `charter` | string | Who charted it (default: "AutoDrums") |
| `diff_drums` | int | Difficulty rating (-1 = unrated) |
| `song_length` | int | Duration in milliseconds |
| `pro_drums` | bool | Whether chart uses pro drums (tom/cymbal distinction) |
| `delay` | int | Audio offset in milliseconds |
| `preview_start_time` | int | Where preview playback starts (ms) |

### INI Serializer

```typescript
function serializeSongIni(metadata: SongMetadata): string {
  const lines = ['[song]']
  lines.push(`name = ${metadata.name}`)
  lines.push(`artist = ${metadata.artist}`)
  lines.push(`album = ${metadata.album ?? ''}`)
  lines.push(`genre = ${metadata.genre ?? ''}`)
  lines.push(`year = ${metadata.year ?? ''}`)
  lines.push(`charter = ${metadata.charter ?? 'AutoDrums'}`)
  lines.push(`diff_drums = -1`)
  lines.push(`preview_start_time = 0`)
  lines.push(`song_length = ${Math.round(metadata.durationMs)}`)
  lines.push(`delay = 0`)
  lines.push(`pro_drums = True`)
  return lines.join('\r\n') + '\r\n'
}
```

---

## 3. Audio Encoding

The pipeline produces PCM Float32 stems in OPFS. Clone Hero expects `.ogg` (preferred) or `.wav`.

### WAV Encoding (v1 — simple, no dependencies)

Encode raw PCM to WAV in the browser:

```typescript
function encodeWav(
  pcmData: Float32Array,  // interleaved stereo
  sampleRate: number,
  numChannels: number
): ArrayBuffer {
  const bytesPerSample = 2  // 16-bit
  const dataLength = pcmData.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  // RIFF header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(view, 8, 'WAVE')

  // fmt chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)           // chunk size
  view.setUint16(20, 1, true)            // PCM format
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true)
  view.setUint16(32, numChannels * bytesPerSample, true)
  view.setUint16(34, bytesPerSample * 8, true)

  // data chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataLength, true)

  // Convert Float32 [-1, 1] to Int16
  const offset = 44
  for (let i = 0; i < pcmData.length; i++) {
    const sample = Math.max(-1, Math.min(1, pcmData[i]))
    view.setInt16(offset + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
  }

  return buffer
}
```

### OGG Encoding (v2 — smaller files)

Options for browser-based OGG encoding:
1. **WASM-based encoder** (e.g., `libvorbis` compiled to WASM)
2. **MediaRecorder API** — not reliable for offline encoding
3. **Opus via WebCodecs** — not widely supported yet

Recommendation: Ship with WAV first, add OGG later.

---

## 4. .zip Export

Use `fflate` (fast, lightweight, browser-native zip):

```typescript
import { zipSync, strToU8 } from 'fflate'

async function exportAsZip(projectName: string, metadata: SongMetadata): Promise<Blob> {
  const chartText = await readEditedChart(projectName)
  const songIni = serializeSongIni(metadata)
  const drumsWav = await encodeStemAsWav(projectName, 'drums')
  const songWav = await encodeStemAsWav(projectName, 'no_drums')

  const zipData = zipSync({
    'notes.chart': strToU8(chartText),
    'song.ini': strToU8(songIni),
    'drums.wav': new Uint8Array(drumsWav),
    'song.wav': new Uint8Array(songWav),
  })

  return new Blob([zipData], { type: 'application/zip' })
}
```

---

## 5. Testing Strategy

**Every export capability must have unit tests that verify round-trip integrity.**

### Test Pattern: Export → scan-chart

```typescript
import { scanChartFolder } from 'scan-chart'

describe('zip export', () => {
  test('exported zip round-trips through scanChartFolder', async () => {
    // Create a known chart
    const chart = createTestChart()
    const chartText = serializeChart(chart)
    const songIni = serializeSongIni(testMetadata)
    const drumsWav = createSilentWav(44100, 2, 5.0) // 5 seconds of silence

    // Package as zip
    const zipBlob = await exportAsZip(/* ... */)

    // Unzip and present as file map for scan-chart
    const files = await unzip(await zipBlob.arrayBuffer())
    const fileMap = new Map(files.map(f => [f.name, f.data]))

    // Verify scan-chart can read it
    const result = scanChartFolder(fileMap)
    expect(result.chart).toBeDefined()
    expect(result.chart.resolution).toBe(480)
    expect(result.chart.trackData).toHaveLength(1)
    expect(result.chart.trackData[0].instrument).toBe('drums')
    expect(result.chart.trackData[0].noteEventGroups.length).toBe(chart.tracks[0].notes.length)
  })

  test('song.ini fields are correct', async () => {
    const zipBlob = await exportAsZip(/* ... */)
    const files = await unzip(await zipBlob.arrayBuffer())
    const iniText = new TextDecoder().decode(files.find(f => f.name === 'song.ini')!.data)

    expect(iniText).toContain('name = Test Song')
    expect(iniText).toContain('pro_drums = True')
    expect(iniText).toContain('charter = AutoDrums')
  })

  test('audio files are valid WAV', async () => {
    const zipBlob = await exportAsZip(/* ... */)
    const files = await unzip(await zipBlob.arrayBuffer())
    const drumsWav = files.find(f => f.name === 'drums.wav')!.data

    // Check WAV header
    const view = new DataView(drumsWav.buffer)
    expect(String.fromCharCode(...drumsWav.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...drumsWav.slice(8, 12))).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(2) // stereo
    expect(view.getUint32(24, true)).toBe(44100) // sample rate
  })
})
```

### Test Cases

1. **Minimal chart** — single note, single tempo, verify round-trip
2. **Complex chart** — many notes, tempo changes, sections, pro drums
3. **Audio integrity** — WAV header is valid, correct sample rate/channels
4. **song.ini completeness** — all required fields present
5. **Large chart** — 10,000+ notes, verify performance
6. **Empty chart** — no notes, still produces valid package
7. **Special characters** — song name with unicode, quotes, etc.

---

## 6. Export UI

```
+--------------------------------------------+
|  Export Chart                               |
|                                             |
|  Song: "My Song" - Artist Name              |
|                                             |
|  Audio: [WAV (lossless)] / [OGG (smaller)]  |
|                                             |
|  Include:                                   |
|    [x] Drum stem                            |
|    [x] Accompaniment (song.wav)             |
|    [ ] Album art                            |
|                                             |
|  [Download .zip]                            |
+--------------------------------------------+
```

---

## 7. Implementation Order

1. **WAV encoder** (`src/audio/wav-encoder.ts`) + tests
2. **song.ini serializer** (`src/chart-io/song-ini.ts`) + tests
3. **ZIP packaging** (`src/export/zip.ts` using fflate) + round-trip tests
4. **Export UI** component
5. **OGG encoding** (v2, WASM-based) — optional, can ship without
