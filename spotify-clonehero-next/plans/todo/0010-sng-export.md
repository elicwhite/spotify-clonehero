# 0010 - SNG File Export

> **Dependencies:** 0002 (chart writing — provides `serializeChart` and chart types), 0009 (ZIP export — prior art for packaging, shares `song.ini` serializer and WAV encoder)
> **Unlocks:** Single-file chart distribution (alternative to .zip); faster Clone Hero loading (no decompression)
>
> **Code:** `lib/drum-transcription/export/sng.ts`
> **Tests:** `lib/drum-transcription/__tests__/sng-export.test.ts`
> **Browser-only:** All binary manipulation uses `Uint8Array`, `DataView`, and `ArrayBuffer`. No Node.js `fs` or `Buffer`.

## Overview

The `.sng` format is a binary container that bundles chart files, audio stems, metadata, and album art into a single file. Unlike `.zip`, SNG files are **uncompressed** — file contents are XOR-masked but not deflated. This makes SNG ideal for streaming audio from the container without loading the entire file into memory (via memory-mapped files in native applications).

Clone Hero and YARG both support `.sng` as a first-class format. The format is defined by the [SngFileFormat](https://github.com/mdsitton/SngFileFormat) project. We already have `parse-sng` (v4.0.3) as a dependency for reading `.sng` files; this plan covers the inverse operation: **writing** `.sng` files.

---

## 1. SNG Binary Format Specification

All multi-byte integers are **little-endian**. The format version is currently `1`.

### 1.1 Overall Layout

```
+--------------------+
| Header             |  (26 bytes fixed)
+--------------------+
| Metadata Section   |  (variable)
+--------------------+
| FileIndex Section  |  (variable)
+--------------------+
| FileData Section   |  (variable)
+--------------------+
```

Each of the three sections after the header is prefixed with a `uint64` section length.

### 1.2 Header (26 bytes)

| Offset | Field            | Type     | Size | Value/Description                              |
|--------|------------------|----------|------|-------------------------------------------------|
| 0      | `fileIdentifier` | bytes    | 6    | `0x53 0x4E 0x47 0x50 0x4B 0x47` = ASCII `SNGPKG` |
| 6      | `version`        | uint32   | 4    | `1` (current version)                           |
| 10     | `xorMask`        | byte[16] | 16   | 16 random bytes used for XOR masking file data   |

### 1.3 Metadata Section

| Offset (relative) | Field             | Type           | Size              | Description                                |
|--------------------|-------------------|----------------|-------------------|--------------------------------------------|
| 0                  | `metadataLen`     | uint64         | 8                 | Byte length of everything after this field |
| 8                  | `metadataCount`   | uint64         | 8                 | Number of key-value pairs                  |
| 16+                | `metadataPairs[]` | MetadataPair[] | metadataLen - 8   | Repeated key-value pair structures         |

**MetadataPair structure:**

| Field      | Type   | Size     | Description                          |
|------------|--------|----------|--------------------------------------|
| `keyLen`   | int32  | 4        | UTF-8 byte length of the key string  |
| `key`      | string | keyLen   | UTF-8 key (no null terminator)       |
| `valueLen` | int32  | 4        | UTF-8 byte length of the value string |
| `value`    | string | valueLen | UTF-8 value (no null terminator)     |

**Important:** Metadata replaces the `song.ini` file. The SNG format does NOT include a `song.ini` file in the file index; all song.ini fields are stored as metadata key-value pairs. The `parse-sng` library's `generateSongIni` option reconstructs a song.ini from metadata at read time.

**Metadata string restrictions** (from the spec):
- No semicolons (`;`) in keys or values
- No newline characters (`\r`, `\n`) in keys or values
- No equals signs (`=`) in keys (allowed in values)
- No null bytes (`0x00`)

### 1.4 FileIndex Section

| Offset (relative) | Field           | Type       | Size            | Description                                |
|--------------------|-----------------|------------|----------------|--------------------------------------------|
| 0                  | `fileMetaLen`   | uint64     | 8              | Byte length of everything after this field |
| 8                  | `fileCount`     | uint64     | 8              | Number of files                            |
| 16+                | `fileMetas[]`   | FileMeta[] | fileMetaLen - 8 | Repeated file metadata structures          |

**FileMeta structure:**

| Field           | Type   | Size        | Description                                                        |
|-----------------|--------|-------------|--------------------------------------------------------------------|
| `filenameLen`   | byte   | 1           | UTF-8 byte length of filename (max 255)                            |
| `filename`      | string | filenameLen | Relative path, folders separated by `/`                            |
| `contentsLen`   | uint64 | 8           | Byte length of file contents                                      |
| `contentsIndex` | uint64 | 8           | **Absolute** byte offset from start of file to this file's data    |

**Critical detail — `contentsIndex` is absolute.** The reference C# implementation (`SngSerializer.cs` line 360) sets `contentsIndex` to the absolute byte offset from the beginning of the `.sng` file:
```csharp
sngFile.WriteFileIndex(fileIndexLength, (ulong)headerData.Length, headerData, ref pos);
```
Where `headerData.Length` equals the total size of header + metadata section + file index section + the fileData section-length uint64. The first file's `contentsIndex` therefore points right past the `fileDataLen` field.

### 1.5 FileData Section

| Offset (relative) | Field           | Type         | Size          | Description                    |
|--------------------|-----------------|--------------|---------------|--------------------------------|
| 0                  | `fileDataLen`   | uint64       | 8             | Total byte length of all files |
| 8+                 | `files[]`       | maskedByte[] | fileDataLen   | Concatenated masked file data  |

Files are written contiguously with **no padding or alignment** between them.

### 1.6 XOR Masking Algorithm

File data is masked (not encrypted — this is intentional obfuscation so binary scanners don't misidentify embedded files). The algorithm from the spec:

```
for i = 0 to len(fileBytes) - 1:
    xorKey = xorMask[i % 16] XOR (i AND 0xFF)
    maskedBytes[i] = fileBytes[i] XOR xorKey
```

The masking is **symmetric**: applying the same operation to masked data produces the original. The `i` counter resets to 0 for each file (per the reference implementation in `SngSerializer.cs` — `MaskData` is called per-file with `filePos = 0`).

**TypeScript implementation:**

```typescript
function maskFileData(data: Uint8Array, xorMask: Uint8Array): Uint8Array {
  const masked = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) {
    const xorKey = xorMask[i % 16] ^ (i & 0xFF)
    masked[i] = data[i] ^ xorKey
  }
  return masked
}
```

---

## 2. Metadata Strategy

SNG metadata replaces `song.ini`. The keys are the same INI keys used by Clone Hero. We reuse the `SongMetadata` type from 0009 and the `song.ini` serializer's field list:

| Metadata Key           | Type   | Default Value     | Source                       |
|------------------------|--------|-------------------|------------------------------|
| `name`                 | string | `"Unknown Name"`  | User input / metadata        |
| `artist`               | string | `"Unknown Artist"`| User input / metadata        |
| `album`                | string | `"Unknown Album"` | User input / metadata        |
| `genre`                | string | `"Unknown Genre"` | User input / metadata        |
| `year`                 | string | `"Unknown Year"`  | User input / metadata        |
| `charter`              | string | `"AutoDrums"`     | Default for our pipeline     |
| `song_length`          | string | Computed (ms)     | Duration of audio            |
| `diff_drums`           | string | `"-1"`            | Unrated                      |
| `pro_drums`            | string | `"True"`          | Always true for our pipeline |
| `delay`                | string | `"0"`             | Audio offset in ms           |
| `preview_start_time`   | string | `"-1"`            | Optional                     |

All values are stored as strings per the SNG spec, even numeric ones. Skip pairs where the key or value is empty (matching the reference C# serializer behavior: `if (string.IsNullOrEmpty(metadata.Key) || string.IsNullOrEmpty(metadata.Value)) continue`).

---

## 3. File Contents

The SNG container holds the same files as the ZIP export (0009), minus `song.ini` (which becomes metadata):

| Filename         | Required | Source                             |
|------------------|----------|------------------------------------|
| `notes.chart`    | Yes      | `serializeChart()` from 0002       |
| `drums.wav`      | Yes      | WAV encoder from 0009              |
| `song.wav`       | Yes      | WAV encoder from 0009              |
| `album.png`      | No       | User-provided album art            |
| `album.jpg`      | No       | Alternative to album.png           |

**Filenames must be lowercase** per the SNG filename registry. The reference encoder forces registered filenames to lowercase.

---

## 4. TypeScript Serialization

### 4.1 Public API

```typescript
// lib/drum-transcription/export/sng.ts

export interface SngFileEntry {
  /** Relative filename (e.g. "notes.chart"). Must be <= 255 UTF-8 bytes. */
  filename: string
  /** Raw file contents as Uint8Array */
  data: Uint8Array
}

export interface SngMetadata {
  [key: string]: string
}

/**
 * Serialize files and metadata into an SNG binary container.
 * Returns the complete .sng file as a Uint8Array.
 *
 * Browser-only: uses DataView/Uint8Array, no Node.js dependencies.
 */
export function buildSngFile(
  metadata: SngMetadata,
  files: SngFileEntry[],
): Uint8Array
```

### 4.2 Size Calculation

Before writing, pre-calculate sizes for each section (same strategy as the reference C# implementation):

```typescript
function calculateSizes(metadata: SngMetadata, files: SngFileEntry[]) {
  const encoder = new TextEncoder()

  // Header: 6 (identifier) + 4 (version) + 16 (xorMask) = 26
  const headerSize = 26

  // Metadata section: 8 (metadataLen) + 8 (metadataCount) + sum of pairs
  let metadataPayloadSize = 8 // metadataCount
  const entries = Object.entries(metadata).filter(([k, v]) => k && v)
  for (const [key, value] of entries) {
    metadataPayloadSize += 4 + encoder.encode(key).length  // keyLen + key
    metadataPayloadSize += 4 + encoder.encode(value).length // valueLen + value
  }
  const metadataSectionSize = 8 + metadataPayloadSize // sectionLen + payload

  // FileIndex section: 8 (fileMetaLen) + 8 (fileCount) + sum of file metas
  let fileIndexPayloadSize = 8 // fileCount
  for (const file of files) {
    fileIndexPayloadSize += 1 + encoder.encode(file.filename).length // filenameLen + filename
    fileIndexPayloadSize += 8 + 8 // contentsLen + contentsIndex
  }
  const fileIndexSectionSize = 8 + fileIndexPayloadSize // sectionLen + payload

  // FileData section: 8 (fileDataLen) + sum of file contents
  const totalFileDataSize = files.reduce((sum, f) => sum + f.data.length, 0)
  const fileDataSectionSize = 8 + totalFileDataSize

  // Total
  const totalSize = headerSize + metadataSectionSize + fileIndexSectionSize + fileDataSectionSize

  // The absolute offset where file data starts (right after the fileDataLen field)
  const fileDataStartOffset = headerSize + metadataSectionSize + fileIndexSectionSize + 8

  return {
    headerSize,
    metadataPayloadSize,
    metadataEntryCount: entries.length,
    fileIndexPayloadSize,
    totalFileDataSize,
    totalSize,
    fileDataStartOffset,
    filteredEntries: entries,
  }
}
```

### 4.3 Writing Logic

```typescript
function buildSngFile(metadata: SngMetadata, files: SngFileEntry[]): Uint8Array {
  const sizes = calculateSizes(metadata, files)
  const buffer = new ArrayBuffer(sizes.totalSize)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  const encoder = new TextEncoder()
  let offset = 0

  // --- Header ---
  // "SNGPKG"
  const identifier = encoder.encode('SNGPKG')
  bytes.set(identifier, offset); offset += 6

  // version = 1
  view.setUint32(offset, 1, true); offset += 4

  // xorMask: 16 random bytes
  const xorMask = crypto.getRandomValues(new Uint8Array(16))
  bytes.set(xorMask, offset); offset += 16

  // --- Metadata Section ---
  // metadataLen (uint64)
  setBigUint64LE(view, offset, BigInt(sizes.metadataPayloadSize)); offset += 8

  // metadataCount (uint64)
  setBigUint64LE(view, offset, BigInt(sizes.metadataEntryCount)); offset += 8

  // metadata pairs
  for (const [key, value] of sizes.filteredEntries) {
    const keyBytes = encoder.encode(key)
    view.setInt32(offset, keyBytes.length, true); offset += 4
    bytes.set(keyBytes, offset); offset += keyBytes.length

    const valueBytes = encoder.encode(value)
    view.setInt32(offset, valueBytes.length, true); offset += 4
    bytes.set(valueBytes, offset); offset += valueBytes.length
  }

  // --- FileIndex Section ---
  // fileMetaLen (uint64)
  setBigUint64LE(view, offset, BigInt(sizes.fileIndexPayloadSize)); offset += 8

  // fileCount (uint64)
  setBigUint64LE(view, offset, BigInt(files.length)); offset += 8

  // file metas — contentsIndex is absolute from start of file
  let fileOffset = sizes.fileDataStartOffset
  for (const file of files) {
    const filenameBytes = encoder.encode(file.filename)
    if (filenameBytes.length > 255) {
      throw new Error(`Filename "${file.filename}" exceeds 255 bytes (got ${filenameBytes.length})`)
    }
    view.setUint8(offset, filenameBytes.length); offset += 1
    bytes.set(filenameBytes, offset); offset += filenameBytes.length
    setBigUint64LE(view, offset, BigInt(file.data.length)); offset += 8
    setBigUint64LE(view, offset, BigInt(fileOffset)); offset += 8
    fileOffset += file.data.length
  }

  // --- FileData Section ---
  // fileDataLen (uint64)
  setBigUint64LE(view, offset, BigInt(sizes.totalFileDataSize)); offset += 8

  // masked file contents
  for (const file of files) {
    const masked = maskFileData(file.data, xorMask)
    bytes.set(masked, offset); offset += masked.length
  }

  return bytes
}
```

### 4.4 BigInt Helper

`DataView.setBigUint64` is available in all modern browsers, but we add a wrapper for clarity:

```typescript
function setBigUint64LE(view: DataView, offset: number, value: bigint): void {
  view.setBigUint64(offset, value, true)
}
```

### 4.5 XOR Mask Generation

Use `crypto.getRandomValues()` (available in all browsers and Web Workers):

```typescript
const xorMask = crypto.getRandomValues(new Uint8Array(16))
```

---

## 5. Integration with Export Pipeline

The SNG exporter slots in alongside the ZIP exporter from 0009. They share the same inputs:

```typescript
// lib/drum-transcription/export/sng.ts

import { serializeChart } from '../chart-io/writer'
import { buildSngFile, type SngMetadata, type SngFileEntry } from './sng'

async function exportAsSng(
  projectName: string,
  metadata: SongMetadata,
): Promise<Blob> {
  // Reuse chart serialization from 0002
  const chartText = await readEditedChart(projectName)
  const chartBytes = new TextEncoder().encode(chartText)

  // Reuse WAV encoding from 0009
  const drumsWav = await encodeStemAsWav(projectName, 'drums')
  const songWav = await encodeStemAsWav(projectName, 'no_drums')

  // Build SNG metadata from song metadata (same fields as song.ini)
  const sngMetadata: SngMetadata = {
    name: metadata.name,
    artist: metadata.artist,
    album: metadata.album ?? '',
    genre: metadata.genre ?? '',
    year: metadata.year ?? '',
    charter: metadata.charter ?? 'AutoDrums',
    song_length: String(Math.round(metadata.durationMs)),
    diff_drums: '-1',
    pro_drums: 'True',
    delay: '0',
    preview_start_time: '-1',
  }

  // Filter out empty values (matching reference implementation)
  const filteredMetadata: SngMetadata = {}
  for (const [key, value] of Object.entries(sngMetadata)) {
    if (key && value) filteredMetadata[key] = value
  }

  const files: SngFileEntry[] = [
    { filename: 'notes.chart', data: chartBytes },
    { filename: 'drums.wav', data: new Uint8Array(drumsWav) },
    { filename: 'song.wav', data: new Uint8Array(songWav) },
  ]

  const sngBytes = buildSngFile(filteredMetadata, files)
  return new Blob([sngBytes], { type: 'application/octet-stream' })
}
```

---

## 6. Round-Trip Testing Strategy

### 6.1 Core Approach: Write SNG -> Read with parse-sng -> Verify

The primary validation is that our serialized `.sng` files can be correctly parsed by `parse-sng` (already a project dependency). This proves compatibility with the ecosystem.

### 6.2 Test Harness

```typescript
// lib/drum-transcription/__tests__/sng-export.test.ts

import { describe, test, expect } from '@jest/globals'
import { buildSngFile, type SngMetadata, type SngFileEntry } from '../export/sng'
import { SngStream, type SngHeader } from 'parse-sng'

/**
 * Helper: parse an SNG buffer using parse-sng and return header + files.
 * parse-sng uses ReadableStream, so we wrap the buffer in one.
 */
async function parseSngBuffer(
  sngBytes: Uint8Array
): Promise<{ header: SngHeader; files: Map<string, Uint8Array> }> {
  return new Promise((resolve, reject) => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(sngBytes)
        controller.close()
      },
    })

    const sngStream = new SngStream(stream)
    let header: SngHeader
    const files = new Map<string, Uint8Array>()
    const fileQueue: Array<{
      name: string
      stream: ReadableStream<Uint8Array>
      next: (() => void) | null
    }> = []

    sngStream.on('header', h => { header = h })

    sngStream.on('file', async (fileName, fileStream, nextFile) => {
      const reader = fileStream.getReader()
      const chunks: Uint8Array[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }
      const totalLen = chunks.reduce((sum, c) => sum + c.length, 0)
      const merged = new Uint8Array(totalLen)
      let offset = 0
      for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.length
      }
      files.set(fileName, merged)

      if (nextFile) {
        nextFile()
      } else {
        resolve({ header: header!, files })
      }
    })

    sngStream.on('error', reject)
    sngStream.start()
  })
}
```

### 6.3 Test Cases

```typescript
describe('SNG export', () => {
  test('minimal SNG round-trips through parse-sng', async () => {
    const metadata: SngMetadata = { name: 'Test Song', artist: 'Test Artist' }
    const chartContent = new TextEncoder().encode('[Song]\n{\n  Name = "Test"\n}\n')
    const files: SngFileEntry[] = [
      { filename: 'notes.chart', data: chartContent },
    ]

    const sngBytes = buildSngFile(metadata, files)
    const { header, files: parsedFiles } = await parseSngBuffer(sngBytes)

    // Verify header
    expect(header.fileIdentifier).toBe('SNGPKG')
    expect(header.version).toBe(1)
    expect(header.xorMask).toHaveLength(16)

    // Verify metadata
    expect(header.metadata['name']).toBe('Test Song')
    expect(header.metadata['artist']).toBe('Test Artist')

    // Verify files
    expect(parsedFiles.has('notes.chart')).toBe(true)
    const parsedChart = new TextDecoder().decode(parsedFiles.get('notes.chart')!)
    expect(parsedChart).toBe('[Song]\n{\n  Name = "Test"\n}\n')
  })

  test('multiple files round-trip correctly', async () => {
    const metadata: SngMetadata = { name: 'Multi File Test' }
    const file1 = new TextEncoder().encode('file 1 contents')
    const file2 = new Uint8Array([0x00, 0xFF, 0x80, 0x01, 0xFE])
    const file3 = new TextEncoder().encode('third file with more data')

    const sngBytes = buildSngFile(metadata, [
      { filename: 'notes.chart', data: file1 },
      { filename: 'drums.wav', data: file2 },
      { filename: 'song.wav', data: file3 },
    ])

    const { files } = await parseSngBuffer(sngBytes)

    expect(files.size).toBe(3)
    expect(new TextDecoder().decode(files.get('notes.chart')!)).toBe('file 1 contents')
    expect(files.get('drums.wav')).toEqual(file2)
    expect(new TextDecoder().decode(files.get('song.wav')!)).toBe('third file with more data')
  })

  test('XOR masking produces different bytes than input', () => {
    const data = new Uint8Array(256).fill(0x42)
    const xorMask = new Uint8Array(16).fill(0xAB)
    const masked = maskFileData(data, xorMask)

    // Masked data should differ from original (unless xorKey happens to be 0)
    let diffCount = 0
    for (let i = 0; i < data.length; i++) {
      if (masked[i] !== data[i]) diffCount++
    }
    expect(diffCount).toBeGreaterThan(200) // most bytes should differ
  })

  test('XOR masking is symmetric', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const xorMask = crypto.getRandomValues(new Uint8Array(16))
    const masked = maskFileData(data, xorMask)
    const unmasked = maskFileData(masked, xorMask)
    expect(unmasked).toEqual(data)
  })

  test('empty file round-trips', async () => {
    const metadata: SngMetadata = { name: 'Empty' }
    const sngBytes = buildSngFile(metadata, [
      { filename: 'empty.txt', data: new Uint8Array(0) },
    ])

    const { files } = await parseSngBuffer(sngBytes)
    expect(files.get('empty.txt')!.length).toBe(0)
  })

  test('large file round-trips', async () => {
    // 1MB of random data
    const largeData = crypto.getRandomValues(new Uint8Array(1024 * 1024))
    const metadata: SngMetadata = { name: 'Large File' }
    const sngBytes = buildSngFile(metadata, [
      { filename: 'big.bin', data: largeData },
    ])

    const { files } = await parseSngBuffer(sngBytes)
    expect(files.get('big.bin')).toEqual(largeData)
  })

  test('metadata with all song.ini fields round-trips', async () => {
    const metadata: SngMetadata = {
      name: 'Full Metadata Song',
      artist: 'Test Artist',
      album: 'Test Album',
      genre: 'Rock',
      year: '2024',
      charter: 'AutoDrums',
      song_length: '240000',
      diff_drums: '-1',
      pro_drums: 'True',
      delay: '0',
      preview_start_time: '55000',
    }

    const sngBytes = buildSngFile(metadata, [
      { filename: 'notes.chart', data: new Uint8Array(0) },
    ])

    const { header } = await parseSngBuffer(sngBytes)

    for (const [key, value] of Object.entries(metadata)) {
      expect(header.metadata[key]).toBe(value)
    }
  })

  test('unicode metadata round-trips', async () => {
    const metadata: SngMetadata = {
      name: 'Bohemian Rhapsody',
      artist: 'Freddie Mercury & Queen',
      loading_phrase: 'Scaramouche, scaramouche',
    }

    const sngBytes = buildSngFile(metadata, [
      { filename: 'notes.chart', data: new Uint8Array(0) },
    ])

    const { header } = await parseSngBuffer(sngBytes)
    expect(header.metadata['loading_phrase']).toBe('Scaramouche, scaramouche')
  })

  test('filename longer than 255 bytes throws', () => {
    const longName = 'a'.repeat(256) + '.txt'
    expect(() => buildSngFile({}, [
      { filename: longName, data: new Uint8Array(0) },
    ])).toThrow(/exceeds 255 bytes/)
  })

  test('contentsIndex values are correct absolute offsets', async () => {
    const file1 = new Uint8Array([1, 2, 3])
    const file2 = new Uint8Array([4, 5, 6, 7, 8])
    const metadata: SngMetadata = { name: 'Offsets' }

    const sngBytes = buildSngFile(metadata, [
      { filename: 'a.txt', data: file1 },
      { filename: 'b.txt', data: file2 },
    ])

    const { header } = await parseSngBuffer(sngBytes)

    // Verify contentsLen
    expect(header.fileMeta[0].contentsLen).toBe(BigInt(3))
    expect(header.fileMeta[1].contentsLen).toBe(BigInt(5))

    // Verify second file index = first file index + first file length
    const firstIndex = header.fileMeta[0].contentsIndex
    const secondIndex = header.fileMeta[1].contentsIndex
    expect(secondIndex).toBe(firstIndex + BigInt(3))
  })

  test('full integration: chart + audio round-trips', async () => {
    // Build a realistic SNG with chart text and fake WAV data
    const chartText = [
      '[Song]', '{', '  Name = "Integration Test"', '  Resolution = 480', '}',
      '[SyncTrack]', '{', '  0 = TS 4', '  0 = B 120000', '}',
      '[Events]', '{', '}',
      '[ExpertDrums]', '{', '  0 = N 0 0', '  480 = N 1 0', '}',
    ].join('\r\n') + '\r\n'

    // Fake WAV: RIFF header + silence
    const wavHeader = new Uint8Array(44)
    const wavView = new DataView(wavHeader.buffer)
    new TextEncoder().encodeInto('RIFF', wavHeader)
    wavView.setUint32(4, 36, true)
    new TextEncoder().encodeInto('WAVE', wavHeader.subarray(8))

    const metadata: SngMetadata = {
      name: 'Integration Test',
      artist: 'Bot',
      charter: 'AutoDrums',
      pro_drums: 'True',
      diff_drums: '-1',
      song_length: '5000',
    }

    const sngBytes = buildSngFile(metadata, [
      { filename: 'notes.chart', data: new TextEncoder().encode(chartText) },
      { filename: 'drums.wav', data: wavHeader },
      { filename: 'song.wav', data: wavHeader },
    ])

    const { header, files } = await parseSngBuffer(sngBytes)

    // Metadata check
    expect(header.metadata['name']).toBe('Integration Test')
    expect(header.metadata['pro_drums']).toBe('True')

    // File count check
    expect(files.size).toBe(3)

    // Chart content check
    const parsedChart = new TextDecoder().decode(files.get('notes.chart')!)
    expect(parsedChart).toContain('[ExpertDrums]')
    expect(parsedChart).toContain('0 = N 0 0')
  })
})
```

### 6.4 Test Categories Summary

| # | Test | What it validates |
|---|------|-------------------|
| 1 | Minimal SNG round-trip | Header, metadata, single file |
| 2 | Multiple files | File index ordering, contiguous data |
| 3 | XOR masking differs | Masking actually transforms data |
| 4 | XOR masking symmetric | mask(mask(data)) === data |
| 5 | Empty file | Zero-length file handling |
| 6 | Large file (1MB) | No size-related bugs, correct offsets |
| 7 | All metadata fields | Full song.ini field coverage |
| 8 | Unicode metadata | UTF-8 encoding correctness |
| 9 | Filename too long | Validation / error handling |
| 10 | Absolute offsets | contentsIndex correctness |
| 11 | Full integration | Chart + WAV + metadata end-to-end |

---

## 7. Edge Cases and Undefined Behavior

### 7.1 Confirmed by Reference Implementation

These behaviors are confirmed by reading `SngSerializer.cs` in `~/projects/SngFileFormat/SngTool/SngLib/`:

- **`contentsIndex` is an absolute offset** from byte 0 of the `.sng` file (line 329: `bytesOut.WriteUInt64LE(ref pos, fileOffset)` where `fileOffset` starts at `headerData.Length`).
- **Empty metadata pairs are skipped** (line 298: `if (string.IsNullOrEmpty(metadata.Key) || string.IsNullOrEmpty(metadata.Value)) continue`).
- **No padding between files** — files are written contiguously (line 367-376).
- **XOR mask is per-file** — `MaskData` is called once per file with position starting at 0 (line 373).
- **Version must be 1** (line 335: `if (sngFile.Version != SngFile.CurrentVersion) throw`).

### 7.2 Not Explicitly Specified

- **Metadata key ordering** — The spec does not mandate an order. We write in insertion order (matching `Object.entries` behavior). The reference implementation iterates a `Dictionary<string, string>` which has no guaranteed order.
- **File ordering** — The spec does not mandate an order. We write in the order provided to `buildSngFile`. The reference implementation iterates a `Dictionary<string, NativeByteArray?>`.
- **Duplicate metadata keys** — The spec does not address this. We deduplicate by using a `Record<string, string>` (last write wins). The reference uses `Dictionary.TryAdd` + overwrite.
- **Duplicate filenames** — The spec does not address this. We treat as an error and throw.

### 7.3 Source Projects

For any behavior not covered above:

- **Canonical spec:** `~/projects/SngFileFormat/README.md`
- **Reference serializer (C#):** `~/projects/SngFileFormat/SngTool/SngLib/SngSerializer.cs`
- **Reference data model (C#):** `~/projects/SngFileFormat/SngTool/SngLib/SngFile.cs`
- **JS parser (read-only):** `~/projects/spotify-clonehero/spotify-clonehero-next/node_modules/parse-sng/index.ts`
- **Metadata key registry:** References `~/projects/GuitarGame_ChartFormats` for known metadata keys (song.ini tags)
- **Moonscraper Chart Editor:** `~/projects/Moonscraper-Chart-Editor` — does not contain SNG read/write code (confirmed by search)

---

## 8. Implementation Order

1. **`maskFileData` utility** — XOR masking function with unit tests for symmetry
2. **`calculateSizes`** — Pre-calculate all section sizes and offsets
3. **`buildSngFile`** — Main serializer using DataView/Uint8Array
4. **Round-trip tests** — Write with `buildSngFile`, read back with `parse-sng`, verify equality
5. **`exportAsSng` integration** — Wire into the export pipeline alongside ZIP export from 0009
6. **Export UI update** — Add SNG option to ExportDialog (format selector: ZIP / SNG)

---

## 9. Performance Considerations

- **Memory:** SNG files can be large (WAV audio is uncompressed). A 5-minute stereo 44.1kHz WAV is ~52MB. The SNG file will be at least that size plus overhead. Ensure the browser tab has sufficient memory.
- **XOR masking cost:** Linear O(n) over all file data. For 100MB of audio this is fast (<100ms on modern hardware) but should be done off the main thread if possible (Web Worker).
- **Single allocation:** Pre-calculate total size and allocate one `ArrayBuffer` upfront. Avoid intermediate copies.
- **Streaming alternative:** For very large files, a streaming writer could avoid holding the entire file in memory. However, `contentsIndex` requires knowing all section sizes upfront, so the header must be written before file data. A two-pass approach (calculate sizes, then stream) is possible but adds complexity. Defer to v2 if memory becomes an issue.

---

## 10. Browser API Notes

| API | Purpose | Browser Support |
|-----|---------|-----------------|
| `DataView` | Read/write typed integers to ArrayBuffer | All modern browsers |
| `DataView.setBigUint64` | Write uint64 values | Chrome 67+, Firefox 68+, Safari 15+ |
| `TextEncoder` | UTF-8 string to bytes | All modern browsers |
| `crypto.getRandomValues` | Generate random XOR mask | All modern browsers + Web Workers |
| `Blob` | Package final output for download | All modern browsers |
| `URL.createObjectURL` | Create download link | All modern browsers |

All required APIs are available in the browser contexts we target (modern Chrome/Firefox/Safari). No polyfills needed.
