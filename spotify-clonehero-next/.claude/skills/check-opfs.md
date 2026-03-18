---
name: check-opfs
description: Inspect the Origin Private File System in the browser to debug stored files, check project state, and verify OPFS operations.
user_invocable: true
---

# Inspect OPFS

Debug what's stored in the browser's Origin Private File System. The app registers WebMCP tools for OPFS inspection via `navigator.modelContext` (defined in `app/WebMCPTools.tsx`). Call them via `evaluate_script` using `navigator.modelContextTesting.executeTool()`.

Ensure the browser is on `http://localhost:3000` (any page) before calling.

## Tools

### List files

List all OPFS contents, or a specific subdirectory:

```
evaluate_script: async () => JSON.parse(await navigator.modelContextTesting.executeTool("opfs_list", JSON.stringify({})))
```

List just the drum-transcription projects:

```
evaluate_script: async () => JSON.parse(await navigator.modelContextTesting.executeTool("opfs_list", JSON.stringify({ path: "drum-transcription" })))
```

Drill into a specific project:

```
evaluate_script: async () => JSON.parse(await navigator.modelContextTesting.executeTool("opfs_list", JSON.stringify({ path: "drum-transcription/PROJECT_NAME" })))
```

### Read a text file

Read JSON, .chart, .ini, or any text file:

```
evaluate_script: async () => JSON.parse(await navigator.modelContextTesting.executeTool("opfs_read_text", JSON.stringify({ path: "drum-transcription/PROJECT_NAME/chart/notes.chart", maxLines: 50 })))
```

Omit `maxLines` for the full file:

```
evaluate_script: async () => JSON.parse(await navigator.modelContextTesting.executeTool("opfs_read_text", JSON.stringify({ path: "drum-transcription/PROJECT_NAME/project.json" })))
```

### Check PCM audio info

Get size and duration of PCM stem files:

```
evaluate_script: async () => JSON.parse(await navigator.modelContextTesting.executeTool("opfs_pcm_info", JSON.stringify({ path: "drum-transcription/PROJECT_NAME/stems" })))
```

### Check storage quota

```
evaluate_script: async () => JSON.parse(await navigator.modelContextTesting.executeTool("opfs_storage_quota", JSON.stringify({})))
```

### Delete a project

```
evaluate_script: async () => JSON.parse(await navigator.modelContextTesting.executeTool("opfs_delete", JSON.stringify({ path: "drum-transcription/PROJECT_NAME" })))
```

### Clear all drum-transcription data

```
evaluate_script: async () => JSON.parse(await navigator.modelContextTesting.executeTool("opfs_delete", JSON.stringify({ path: "drum-transcription" })))
```

## Usage

If an argument is provided (e.g., `/check-opfs my-song`), list that project's files. Otherwise, list all drum-transcription projects.

Replace `PROJECT_NAME` in the commands above with actual project names from the listing.
