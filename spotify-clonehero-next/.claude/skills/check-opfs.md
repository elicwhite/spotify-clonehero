---
name: check-opfs
description: Inspect the Origin Private File System in the browser to debug stored files, check project state, and verify OPFS operations.
user_invocable: true
---

# Inspect OPFS

Debug what's stored in the browser's Origin Private File System. Useful for verifying audio storage, chart saves, and project state during development.

First ensure the browser is on `http://localhost:3000` (any page), then use the scripts below via `evaluate_script`.

## Scripts

### List everything in OPFS

Use when: you want a full tree view of all stored files.

```javascript
async function listOPFS(dir, path = '') {
  const entries = [];
  for await (const [name, handle] of dir) {
    const fullPath = path ? `${path}/${name}` : name;
    if (handle.kind === 'directory') {
      entries.push({ path: fullPath, kind: 'directory' });
      const subDir = await dir.getDirectoryHandle(name);
      entries.push(...await listOPFS(subDir, fullPath));
    } else {
      const file = await handle.getFile();
      entries.push({
        path: fullPath,
        kind: 'file',
        size: file.size,
        sizeHuman: file.size > 1048576 ? (file.size / 1048576).toFixed(1) + ' MB' : (file.size / 1024).toFixed(1) + ' KB',
        lastModified: new Date(file.lastModified).toISOString()
      });
    }
  }
  return entries;
}
const root = await navigator.storage.getDirectory();
const all = await listOPFS(root);
JSON.stringify(all, null, 2);
```

### List drum-transcription projects only

Use when: you want to see just the transcription-related data without other OPFS noise (SQLocal DB, chorus caches, etc.).

```javascript
async function listOPFS(dir, path = '') {
  const entries = [];
  for await (const [name, handle] of dir) {
    const fullPath = path ? `${path}/${name}` : name;
    if (handle.kind === 'directory') {
      const subDir = await dir.getDirectoryHandle(name);
      entries.push(...await listOPFS(subDir, fullPath));
    } else {
      const file = await handle.getFile();
      entries.push({ path: fullPath, size: file.size, sizeHuman: file.size > 1048576 ? (file.size / 1048576).toFixed(1) + ' MB' : (file.size / 1024).toFixed(1) + ' KB' });
    }
  }
  return entries;
}
try {
  const root = await navigator.storage.getDirectory();
  const dtDir = await root.getDirectoryHandle('drum-transcription');
  JSON.stringify(await listOPFS(dtDir, 'drum-transcription'), null, 2);
} catch (e) {
  JSON.stringify({ error: 'No drum-transcription directory in OPFS' });
}
```

### Read a JSON file from OPFS

Use when: you need to inspect project.json, meta.json, confidence.json, etc. Replace the path parts as needed.

```javascript
const root = await navigator.storage.getDirectory();
const dt = await root.getDirectoryHandle('drum-transcription');
const project = await dt.getDirectoryHandle('PROJECT_NAME');
const dir = await project.getDirectoryHandle('SUBDIR');
const handle = await dir.getFileHandle('FILENAME.json');
const file = await handle.getFile();
const text = await file.text();
JSON.stringify(JSON.parse(text), null, 2);
```

### Read a .chart file (first 50 lines)

Use when: you need to inspect a generated chart file.

```javascript
const root = await navigator.storage.getDirectory();
const dt = await root.getDirectoryHandle('drum-transcription');
const project = await dt.getDirectoryHandle('PROJECT_NAME');
const chartDir = await project.getDirectoryHandle('chart');
const handle = await chartDir.getFileHandle('notes.chart');
const file = await handle.getFile();
const text = await file.text();
text.split('\n').slice(0, 50).join('\n');
```

### Check PCM audio file info

Use when: you need to verify a stem was stored correctly. PCM files are Float32 interleaved stereo at 44100 Hz.

```javascript
const root = await navigator.storage.getDirectory();
const dt = await root.getDirectoryHandle('drum-transcription');
const project = await dt.getDirectoryHandle('PROJECT_NAME');
const stemsDir = await project.getDirectoryHandle('stems');
const entries = [];
for await (const [name, handle] of stemsDir) {
  if (handle.kind === 'file') {
    const file = await handle.getFile();
    const samples = file.size / 4; // Float32 = 4 bytes
    const channels = 2;
    const sampleRate = 44100;
    const durationSec = samples / channels / sampleRate;
    entries.push({
      name,
      sizeBytes: file.size,
      sizeMB: (file.size / 1048576).toFixed(1),
      durationSec: durationSec.toFixed(1),
      durationFormatted: `${Math.floor(durationSec / 60)}:${(durationSec % 60).toFixed(0).padStart(2, '0')}`
    });
  }
}
JSON.stringify(entries, null, 2);
```

### Check storage quota

Use when: you want to see how much OPFS space is used.

```javascript
const estimate = await navigator.storage.estimate();
JSON.stringify({
  used: (estimate.usage / 1048576).toFixed(1) + ' MB',
  quota: (estimate.quota / 1048576).toFixed(0) + ' MB',
  percent: ((estimate.usage / estimate.quota) * 100).toFixed(1) + '%'
});
```

### Delete a project from OPFS

Use when: you need to clean up a test project.

```javascript
const root = await navigator.storage.getDirectory();
const dt = await root.getDirectoryHandle('drum-transcription');
await dt.removeEntry('PROJECT_NAME', { recursive: true });
'Deleted PROJECT_NAME';
```

### Clear all drum-transcription data

Use when: you need a clean slate for testing.

```javascript
const root = await navigator.storage.getDirectory();
await root.removeEntry('drum-transcription', { recursive: true });
'Cleared all drum-transcription data from OPFS';
```

## Usage

If an argument is provided (e.g., `/check-opfs my-song`), use the "List drum-transcription projects only" script and drill into that specific project. Otherwise, use "List drum-transcription projects only" for a general overview.

Replace `PROJECT_NAME`, `SUBDIR`, and `FILENAME` placeholders in scripts with actual values from the file listing.
