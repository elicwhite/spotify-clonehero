# 0090 — Selector unification

Status: todo

**Scope:** every place in `spotify-clonehero-next` where the user hands the app an audio file, a chart folder, a `.zip`, a `.sng`, or an image — via drag-and-drop, a hidden `<input type="file">`, or a File System Access picker.

**Verdict: PROCEED WITH EDITS.** A contrarian review (§6) confirmed the catalog against the actual code and found it accurate, but flagged that §5.1's risk ordering is backwards — `AudioDropZone`'s narrower extension list is safe to widen (it validates via `decodeAudioData` regardless), while step 2's repointing of `lib/chart-export/transcode-audio.ts`'s extension list is the real landmine (it would silently start throwing on `.wma` in Chrome). It also found that the plan's widened `DropZoneShell` API preserves an existing accessibility bug (no keyboard operability) across all 13 sites, and that no test in the repo exercises the two riskiest new mechanisms (`dataTransfer.items`, `getAsFileSystemHandle`) because jsdom doesn't support them. Read §6 in full before starting; it also flags a 7th `ChartDropZone` consumer in an in-flight worktree not in the original catalog, and disputes the "eight picker ids" count in §5.4 (actual count is 11–12, plus one dynamic id).

Before starting: decide whether to take the full plan or the reduced-scope option in §5.9 (steps 1, 2, 5 only) with the contrarian's edits folded in.

**Repo paths in this document are relative to `spotify-clonehero-next/` unless noted.**

---

## 1. Catalog

Thirteen distinct implementations exist. Nine are user-facing "pick your song/chart" surfaces; four are bare picker call sites with no drop affordance at all. One shared shell (`DropZoneShell`) already exists and is used by two of the nine.

### 1.1 `components/chart-picker/DropZoneShell.tsx` — the existing shared visual

Not a selector; the dashed box only. 77 lines.

- **API:** `{icon: ReactNode, label: string, isDragging: boolean, inert: boolean, onDrop, onDragOver, onDragLeave, onClick, children}`. The caller owns *all* behavior; the shell owns the box.
- **Visual:** `min-h-[9.5rem]`, `border-2 border-dashed`, centered icon + single label line, `cursor-pointer`, `opacity-50 cursor-not-allowed` when `inert`. Dragging → `border-primary bg-primary/5`.
- Stamps `data-nested-dropzone=""` on its root so an enclosing `SectionDropZone` defers to it.
- Also exports `OrDivider` — a hairline/`or`/hairline row used between a drop zone and its secondary button.
- **Consumers:** `ChartDropZone`, `components/project-list/AudioDropZone`. `TrackEditPage` imports `OrDivider` alone.
- **Gap:** it takes no `className`, no size variant, and `label` is `string` (not `ReactNode`), so it cannot express the two-line copy `AudioUploader` shows.

### 1.2 `components/chart-picker/ChartDropZone.tsx` — chart package (the most-used selector)

- **Accepts:** `.zip`, `.sng` by drop or click (`accept=".zip,.sng"`); folders via a separate `showDirectoryPicker({id})` button. **Dropped folders are not supported** — a dropped folder falls through `detectFormat` and produces `toast.error('Please drop a .zip or .sng file')`.
- **Visual:** `DropZoneShell` (`Upload` icon, label `Drop a .zip or .sng file here, or click to browse`, → `Reading files...` while loading), then `OrDivider`, then a full-width outline `Button` with `FolderOpen` reading `Select a chart folder`. Wrapped in `space-y-3`.
- **API:** `{onLoaded: (result: LoadedFiles) => void, disabled?: boolean, id?: string = 'chart-picker', className?: string}`.
- **Disabled:** `disabled || isLoading` blocks drop, click, and the folder button; `inert` greys the shell.
- **Errors:** `sonner` toasts only. Reader exceptions surface as `e.message`. `AbortError` from the folder picker is swallowed (user cancel).
- **Consumers (6):** `LocalChartLoader` (→ `/preview`, `/sheet-music`), `app/add-lyrics/AddLyricsClient.tsx:701`, `app/tempo/TempoClient.tsx:474`, `app/drum-transcription/components/SourcePicker.tsx:89`, `components/chart-editor/TrackEditPage.tsx:485`, `components/difficulty-generation/DifficultyGenerationFlow.tsx:421`.

### 1.3 `components/chart-picker/chart-file-readers.ts` — the shared read layer

Already unified and healthy. `readChartDirectory(dirHandle)` (flat, one level, skips dotfiles), `readZipFile` (fflate, flattens paths to basenames), `readSngFile` (`SngStream`, `generateSongIni: true`, carries `sngMetadata`), `detectFormat(file): 'zip' | 'sng' | null`. All produce `LoadedFiles = {files: FileEntry[], sourceFormat, originalName, sngMetadata?}`. **This file needs no change** and is the model for what the rest should look like.

Note: `readChartDirectory` is **non-recursive** (top-level files only), unlike `lib/sng/read-dropped-entries.ts`'s `walkEntry`, which recurses. That is a real behavioral fork (see §5.4).

### 1.4 `app/drum-transcription/components/AudioUploader.tsx` — audio, card-wrapped, 120 lines

- **Accepts:** any `File` whose `type.startsWith('audio/')` **or** whose name matches `/\.(mp3|wav|ogg|flac|aac|m4a|webm|opus|wma)$/i`. Hidden input `accept="audio/*"`.
- **Visual:** its *own* `<Card><CardContent className="pt-6">` wrapper containing a hand-rolled dashed box (`p-12`, not `DropZoneShell`), a 14×14 muted circle around an `Upload` icon, a **two-line** copy block (`Drag and drop an audio file here` + `MP3, WAV, OGG, FLAC, or other browser-supported audio formats`), and an explicit outline `Browse Files` button. Clicking the box itself does **nothing** — only the button opens the picker.
- **API:** `{onFileSelected: (file: File) => void}` — no `disabled`, no `className`, no `id`.
- **No folder support. No loading state.** Hands the raw `File` up; decoding is the caller's job.
- **Errors:** `toast.error('Please select an audio file (MP3, WAV, OGG, FLAC, etc.)')`.
- Marks itself `data-nested-dropzone`.
- **Consumers (2):** `SourcePicker` (drum-transcription), `app/tempo/TempoClient.tsx:459` — which imports it **cross-page** from `@/app/drum-transcription/components/AudioUploader`. That cross-app import is itself a smell worth fixing regardless of the rest of this plan.

### 1.5 `components/project-list/AudioDropZone.tsx` — audio, bare, 125 lines

A **separate, differently-behaved** audio drop zone from §1.4.

- **Accepts:** extension-only allow-list `['.mp3','.ogg','.opus','.wav','.flac','.m4a']`. **No MIME check** — `audio/aac`, `.aac`, `.webm`, `.wma` are accepted by `AudioUploader` and rejected here.
- **Extra work:** reads bytes, then **decodes with `AudioContext.decodeAudioData` to get the duration**, closing the context in a `finally`. A file the browser can't decode fails *here*, before a project is written. This is deliberate (comment says so).
- **Visual:** `DropZoneShell` with a `Music` icon and label `Drop an audio file here, or click to browse` → `Reading audio...`. Bare (no `Card`); the caller supplies the card.
- **API:** `{onDropped: (audio: {fileName, data: Uint8Array, durationSeconds}) => void, disabled?, className?}`.
- **Errors:** `toast.error('Please drop an audio file')` for a wrong extension; the decode error's `message` otherwise.
- **Consumer (1):** `TrackEditPage` "Create a Chart" card.

### 1.6 `components/landing/SectionDropZone.tsx` — the section-wide classifier (new this session)

- **Accepts:** anything, and routes it. Audio (MIME or the `AudioUploader` regex, duplicated at line 34) → `onAudioFile(file)`. `.zip`/`.sng` → read here with the same readers → `onChartLoaded`. Dropped **folder** → `getAsFileSystemHandle()` → `readChartDirectory` → `onChartLoaded`. Anything else → `toast.error('Drop an audio file, a chart folder, a .zip, or a .sng')`.
- **Visual:** transparent border that becomes `border-primary bg-primary/5` while a drag is over it. Wraps arbitrary `children`.
- **API:** `{onAudioFile, onChartLoaded, disabled?, children, className?}`. No click behavior at all — drop only.
- **Two mechanisms worth keeping:** (a) `isOverNestedZone` checks `e.target.closest('[data-nested-dropzone]')` on *both* `dragover` and `drop`, so nested zones own their drops and the outer highlight clears; (b) `getAsFileSystemHandle()` is *called* synchronously in the drop handler before any `await`, because `dataTransfer` is emptied when the handler returns.
- **Consumers (2):** `TempoClient:421`, `DrumTranscriptionClient:538`.
- **This is the closest thing to the intended end state and should be the seed of the unification** — but it is drop-only, duplicates the audio predicate, and its classification logic is inaccessible to click-driven pickers.

### 1.7 `app/sng/components/DropZone.tsx` — files *and* folders, button grid, 130 lines

- **Accepts:** everything. Drop → `readDroppedItems(dataTransfer)` (recursive `webkitGetAsEntry` walk, flattens to basenames, skips dotfiles). No type validation whatsoever; the SNG package takes any file.
- **Visual:** hand-rolled dashed box (`p-6`, **not** `DropZoneShell`), `Upload` icon, one label line (`Drag files or folders here to add them to the package` → `Reading files…` — note the **U+2026 ellipsis** vs `ChartDropZone`'s three dots), then a wrapped **two-button grid**: `Select files` (`FilePlus`, `pickFiles({id:'sng-add-files', multiple:true})`) and `Add folder` (`FolderOpen`, `showDirectoryPicker({id:'sng-add-folder'})` → `readChartDirectory`). The box itself is not clickable.
- **API:** `{onAdd: (files: FileEntry[]) => void, disabled?: boolean}`.
- **Errors:** `toast.error('No files found in what you dropped')` for an empty result, plus read-failure toasts.
- **Consumer (1):** `app/sng/components/SngEditor.tsx:60`.

### 1.8 `ReplaceChartButton` — inline in `app/add-lyrics/AddLyricsClient.tsx:872–957`

A fourth chart-package entry point, **click-only, no drop**, deliberately compact because the full `ChartDropZone` would duplicate the already-loaded chart card (the comment says exactly this).

- Primary: outline `Button` `Choose new chart` (`FolderOpen`) → `showDirectoryPicker({id:'add-lyrics-chart'})`. Secondary: a bare text link `or pick a .zip / .sng file` → hidden input `accept=".zip,.sng"`.
- Re-implements `handleFile` (`detectFormat` → `readZipFile`/`readSngFile`) and the `AbortError` swallow **verbatim** from `ChartDropZone`. Only the toast copy differs: `Please pick a .zip or .sng file` vs `Please drop a .zip or .sng file`.
- **API:** `{onLoaded: (result: LoadedFiles) => void}`.

### 1.9 `components/chart-editor/sidebar/StemsMixer.tsx:330–410` — inline stem drop target

- **Accepts:** *any* dropped file, **multiple**, added sequentially (`for … await`) so the name uniquifier sees each before the next. Click → `pickFiles({id:'chart-editor-add-stem', multiple:false, types:[{accept:{'audio/*':['.wav','.mp3','.ogg']}}]})` — a **third** audio extension list, and the narrowest one.
- **No extension validation on drop.** Failure is a decode failure: `toast.error('Could not read that audio file')`.
- **Visual:** a `role="button" tabIndex={0}` dashed strip with `Enter`/`Space` keyboard handling — **the only selector in the app that is keyboard-operable.** Two heights: `h-16` centered in the empty state, `h-7` otherwise. Label switches: `Drop an audio file here to add it to this chart` / `Drop an audio file to add a stem`.
- Rendered only when `onAddStem` is provided.

### 1.10 `components/chart-editor/AlbumArtField.tsx` — image, 205 lines

- **Accepts:** images (`ALBUM_ART_ACCEPT` from `lib/album-art`); everything is normalized to a square JPEG by `normalizeAlbumArt` before it reaches state.
- **Visual:** the 80×80 preview square **is** the drop target (`<button>`, correct `aria-label`, dashed only while empty), with `Choose image`/`Replace` and `Remove` buttons beside it and an explanatory note.
- **Errors:** **inline `<p className="text-destructive">`, not a toast** — and it distinguishes `AlbumArtError` (bad file) from anything else (`Something went wrong preparing that image.`, i.e. a bug).
- **API:** `{id, value: AlbumArtFile | null, onChange: (art | null) => void, disabled?}` — a controlled form field, not a one-shot selector.

### 1.11 Bare picker call sites (no drop affordance)

| Location | Picker | Notes |
|---|---|---|
| `app/sng/components/SngLanding.tsx:29` | `pickFiles({id:'sng-modify', types:[{accept:{'application/octet-stream':['.sng']}}]})` | Card button |
| `app/sng/SngClient.tsx:37` | `showDirectoryPicker({id:'sng-convert-folder', mode:'readwrite'})` | Only **readwrite** picker in the app |
| `app/chart-review/ChartReviewClient.tsx:495, 509` | `showDirectoryPicker` + `showOpenFilePicker` (`.tsv`) | Internal tool; persists handles in IndexedDB |
| `lib/local-songs-folder/index.ts:16`, `app/drum-fills/hooks/useLibraryScan.ts:58` | `showDirectoryPicker` | Library/settings-level, not a per-task selector |
| `app/drum-fills/components/MidiStatus.tsx:89` | hidden input `.yaml` | MIDI profile, not audio/chart |

### 1.12 Page-specific behavior wired around the selectors

- **`/drum-transcription`** (`DrumTranscriptionClient:538` → `SourcePicker`): a two-mode chooser (`'audio' | 'chart' | null`) rendered as two 28-unit tall buttons, then a per-mode explanatory line — `Grid source: **predicted**` vs `Grid source: **provided**` — a `Back` button, and `chartFlowError` rendered as inline destructive text *below* the chart zone. Everything wrapped by `SectionDropZone` + a `Card` + a models-download footnote.
- **`/tempo`** (`TempoClient:421`): the *same* three-phase shape (`pick` / `pick-audio` / `pick-chart`), the same two 28-unit buttons, the same `Back` buttons — but the sub-copy differs (`mp3, ogg, opus, wav, flac…` vs `mp3, wav, flac…`), there is **no** grid-source line, and there is `Original/New` variant plumbing that lives entirely in `ResultsView`, downstream of the selector. Inlined into `TempoClient` rather than extracted like `SourcePicker`.
- **`/chart-editor` + drum-transcription editor host** (`TrackEditPage:477–515`): a `md:grid-cols-2` pair of equal-weight `Card`s — *Load a Chart* (`ChartDropZone`) and *Create a Chart* (`AudioDropZone` + `OrDivider` + `Start from scratch`). Both disabled on `pageState === 'loading-chart'`. The two-column framing and the third "blank chart" path are the whole point of the screen.
- **`/drum-difficulties`, `/guitar-difficulties`** (`DifficultyGenerationFlow:421`): a single `Card` titled *Load a Chart*, `ChartDropZone` with **no `disabled`**, and a **separate destructive banner** below (`Can't start {label} difficulty generation`) that deliberately also carries non-chart reasons ("no audio in the package"). Its tests drive a mocked `ChartDropZone` via `getByRole('button', {name: 'drop chart'})`.
- **`/add-lyrics`**: full `ChartDropZone` in the idle state + inline `<p className="text-destructive">{error}</p>`; `ReplaceChartButton` once a chart is loaded.
- **`/preview`, `/sheet-music`**: `LocalChartLoader` inside a collapsed `<details>` ("Or preview a local chart"). `LocalChartLoader` adds semantic validation on top of `ChartDropZone` — `requireDrums` (default `true`, `false` for `/preview`) and "no audio files found" — and reshapes `LoadedFiles` into the Encore-compatible `{metadata, chart, chartDoc, audioFiles}`.

---

## 2. Shared vs Customized

### 2.1 Genuinely shared (should exist exactly once)

1. **The audio predicate.** Three lists exist today and they disagree:
   - `SectionDropZone`/`AudioUploader`: MIME `audio/*` OR `mp3|wav|ogg|flac|aac|m4a|webm|opus|wma`
   - `AudioDropZone`: extension-only `mp3|ogg|opus|wav|flac|m4a`
   - `StemsMixer` picker: `wav|mp3|ogg`
   - and a fourth, `lib/chart-export/transcode-audio.ts` `isAudioFileName`: `wav|mp3|ogg|opus|flac|m4a|aac|weba|webm`

   Four lists for one question. There is no evidence any divergence is intentional (see §5.1 for the one case where it might be).
2. **Chart-package classification and reading.** `detectFormat` + the three readers. Already shared; `SectionDropZone` and `ReplaceChartButton` each re-glue them by hand.
3. **`DataTransfer` extraction.** Two incompatible strategies (`getAsFileSystemHandle` in `SectionDropZone`, `webkitGetAsEntry` in `read-dropped-entries`) plus three "just take `files[0]`" copies. The sync-capture-before-await rule is subtle and currently documented in exactly one place.
4. **Drag state machine.** `isDragging` + `preventDefault` + the `relatedTarget`-contains check on `dragleave` — hand-written 7 times, and only `SectionDropZone` gets the `dragleave` case right.
5. **Busy/disabled composition.** `const busy = disabled || isLoading` appears in 4 files.
6. **`AbortError`-on-cancel swallow.** 5 copies, in 3 different shapes (`e.name === 'AbortError'`, `err instanceof DOMException && err.name === 'AbortError'`, bare `catch {}`). `pickFiles` already solves it for `showOpenFilePicker`; nothing solves it for `showDirectoryPicker`.
7. **The dashed box's visual grammar.** `DropZoneShell` covers two of seven boxes; the other five hand-roll it with drifting padding (`p-12`, `p-6`, `h-7`/`h-16`) and drifting ellipses.
8. **`data-nested-dropzone` participation.** Any drop zone that can sit inside a `SectionDropZone` must opt in. Today that's a manual attribute two components remember to set — a silent-double-handling bug waiting for the third.

### 2.2 Genuinely page-specific (must stay customizable, not unified away)

1. **The grid-source explanatory copy** on `/drum-transcription`. It explains a *modeling* consequence of the choice, not a file-format fact. `/tempo` correctly does not show it.
2. **Whether a page offers an audio-only entry at all.** `/add-lyrics`, the difficulty pages, `/preview`, `/sheet-music` are chart-only by design — an audio file has nothing to align lyrics to and no difficulties to derive.
3. **`TrackEditPage`'s two-panel Load/Create layout** and its third "Start from scratch" path. The panels are a product statement ("two ways in, same weight"); no shared component should own that.
4. **What happens to the file after selection.** `AudioDropZone` decodes duration; `AudioUploader` hands up a raw `File`; `SngDropZone` produces `FileEntry[]`; `LocalChartLoader` produces a parsed Encore-shaped object. These are four different contracts and should stay four.
5. **Error *presentation*.** Toast (`ChartDropZone`), inline destructive text below the zone (`SourcePicker`'s `chartFlowError`, `/add-lyrics`), a full bordered banner with its own heading and a reset button (difficulty pages), or inline field error (`AlbumArtField`). The difficulty banner in particular carries errors that are not about file selection at all. **Do not unify error rendering** — unify only error *classification*.
6. **`AlbumArtField`'s "the preview is the target" design** and its normalize-on-accept pipeline. It is a controlled form field in a dialog, not a task entry point.
7. **`StemsMixer`'s inline strip**, its two heights, its multi-file sequential add, and its keyboard affordance. It lives in a 200px sidebar; a 9.5rem dashed card cannot go there.
8. **`ReplaceChartButton`'s click-only, folder-first shape.** Deliberate: a second dashed box on a screen that already shows a loaded chart reads as "did my upload fail?".
9. **Picker `id`s.** Each surface intentionally remembers its own last-used directory. These must survive migration byte-for-byte or users lose their remembered folders.
10. **`showDirectoryPicker` `mode: 'readwrite'`** in the SNG converter. Only that one call site needs write access; defaulting everything to `readwrite` would trigger a scarier browser permission prompt everywhere.

---

## 3. Proposed Unification

Four layers. Each is independently landable; the migration in §4 lands them bottom-up.

```
lib/file-intake/            (no React)
  accept.ts                 — the file taxonomy, one audio list
  read-transfer.ts          — DataTransfer → classified payload
components/file-intake/
  useFileIntake.ts          — headless drag/click/picker state machine
  DropZoneShell.tsx         — (moved) the dashed box, now variant-aware
  FileDropZone.tsx          — shell + hook, the 90% component
  SectionDropZone.tsx       — (moved) whole-section wrapper, now hook-backed
```

### 3.1 `lib/file-intake/accept.ts` — one taxonomy

```ts
export type IntakeKind = 'audio' | 'chart-package' | 'folder' | 'image' | 'other';

/**
 * The single audio allow-list. Reconciles the four lists in §2.1; the
 * transcode pipeline (lib/chart-export/transcode-audio.ts) imports this
 * rather than keeping its own Set.
 */
export const AUDIO_EXTENSIONS = [
  'mp3','ogg','opus','wav','flac','m4a','aac','webm','weba','wma',
] as const;

/** `accept` attribute / File System Access `types` for each kind. */
export const ACCEPT: Record<'audio' | 'chartPackage' | 'image', {
  attr: string;                          // for <input accept="…">
  pickerTypes: FilePickerAcceptType[];   // for showOpenFilePicker
}>;

export function isAudioFile(file: File): boolean;   // MIME first, extension fallback
export function detectFormat(file: File): 'zip' | 'sng' | null; // re-exported from chart-file-readers
export function classify(file: File): IntakeKind;
```

`components/chart-picker/chart-file-readers.ts` stays exactly where it is and keeps its `LoadedFiles` contract; `accept.ts` re-exports `detectFormat` so callers need one import.

### 3.2 `lib/file-intake/read-transfer.ts` — one `DataTransfer` reader

Generalizes `SectionDropZone.handleDrop` and `readDroppedItems` into one call whose *strategy* is chosen by the caller.

```ts
export type DroppedPayload =
  | {kind: 'audio'; file: File}
  | {kind: 'chart-package'; file: File; format: 'zip' | 'sng'}
  | {kind: 'folder'; handle: FileSystemDirectoryHandle}
  | {kind: 'files'; files: File[]}     // folder-walk strategy, already flattened
  | {kind: 'unrecognized'; file: File | null};

export interface ReadTransferOptions {
  /**
   * 'handle'  — Chromium `getAsFileSystemHandle`, yields a directory handle
   *             (what SectionDropZone/ChartDropZone want: readChartDirectory).
   * 'walk'    — recursive `webkitGetAsEntry` walk to a flat File[]
   *             (what /sng wants: every file, nested folders included).
   * 'files'   — plain `dataTransfer.files`, no folder support.
   */
  folders: 'handle' | 'walk' | 'files';
  multiple?: boolean;
}

/**
 * MUST be called synchronously from the drop handler: `dataTransfer` is
 * emptied when the handler returns, so items and the getAsFileSystemHandle()
 * promise are captured before the first await.
 */
export function readTransfer(
  dt: DataTransfer,
  opts: ReadTransferOptions,
): Promise<DroppedPayload>;
```

The `folders` switch is the honest part: the two existing folder strategies are not interchangeable (§5.4), so the shared layer offers both instead of picking a winner.

### 3.3 `components/file-intake/useFileIntake.ts` — the headless hook

Everything behavioral, no markup. This is what lets `StemsMixer`'s strip, `AlbumArtField`'s square, and a full dashed card share one state machine.

```ts
export interface FileIntakeConfig {
  /** Which kinds this surface accepts. Order is irrelevant. */
  accept: readonly ('audio' | 'chart-package' | 'folder' | 'image' | 'any')[];
  /** Folder-read strategy for drops; also picks the folder-picker behavior. */
  folders?: 'handle' | 'walk' | 'files';          // default 'handle'
  /** Persistent File System Access picker id. Required when a picker is used. */
  pickerId?: string;
  /** `showDirectoryPicker` mode. Default 'read'; only /sng convert needs 'readwrite'. */
  directoryMode?: 'read' | 'readwrite';
  multiple?: boolean;
  disabled?: boolean;

  /** Exactly one of these fires per selection, after classification. */
  onAudio?: (file: File) => void | Promise<void>;
  onChart?: (loaded: LoadedFiles) => void | Promise<void>;
  onFiles?: (files: File[]) => void | Promise<void>;   // 'any' / multi surfaces
  onImage?: (file: File) => void | Promise<void>;

  /**
   * How a rejection is surfaced. Default 'toast'. 'callback' hands the
   * message to `onError` and shows nothing, which is what the pages that
   * render their own destructive text or banner need.
   */
  errorMode?: 'toast' | 'callback';
  onError?: (err: IntakeError) => void;
  /** Overrides the default "that isn't the right kind of file" wording. */
  rejectMessage?: string;
}

export interface IntakeError {
  reason: 'wrong-kind' | 'read-failed' | 'empty';
  message: string;
  cause?: unknown;
}

export interface FileIntake {
  isDragging: boolean;
  isBusy: boolean;                 // config.disabled || a read in flight
  /** Spread onto the drop target. Includes `data-nested-dropzone`. */
  dropProps: {
    onDrop: React.DragEventHandler;
    onDragOver: React.DragEventHandler;
    onDragLeave: React.DragEventHandler;
    'data-nested-dropzone': '';
  };
  /** Render this somewhere inside the target; drives `openFilePicker`. */
  fileInput: React.ReactNode;
  openFilePicker: () => void;                  // hidden <input>
  openFolderPicker: () => Promise<void>;       // showDirectoryPicker + AbortError swallow
}
```

Invariants the hook owns, once: `preventDefault` on both `dragover` and `drop`; the `relatedTarget`-contains guard on `dragleave`; bail out when `e.target.closest('[data-nested-dropzone]')` is a *descendant* zone; sync capture before await; `AbortError` swallow; `input.value = ''` reset; `disabled || busy` gating.

### 3.4 `components/file-intake/DropZoneShell.tsx` — the box, made variant-aware

Same file, moved, with three additions and one widening:

```ts
export interface DropZoneShellProps {
  icon: ReactNode;
  label: ReactNode;                                  // widened from string
  /** Second, smaller line — what AudioUploader shows today. */
  hint?: ReactNode;
  isDragging: boolean;
  inert: boolean;
  /** 'card' = today's min-h-[9.5rem] box. 'compact' = /sng's p-6.
   *  'strip' = StemsMixer's h-7/h-16 sidebar row. */
  variant?: 'card' | 'compact' | 'strip';
  /** Buttons rendered inside the box (Browse Files, Select files + Add folder). */
  actions?: ReactNode;
  /** When false the box itself is not clickable — /sng and AudioUploader,
   *  where the buttons are the only affordance. */
  clickable?: boolean;
  className?: string;
  onClick?: () => void;
  children?: ReactNode;                              // the hidden input
}
```

The three variants are exactly the three sizes that exist today; no new ones are invented. `data-nested-dropzone` moves off the shell and onto `dropProps`, so a target that isn't a `DropZoneShell` (the stem strip, the album-art square) also participates.

### 3.5 `components/file-intake/FileDropZone.tsx` — the composed 90% component

```tsx
export interface FileDropZoneProps extends FileIntakeConfig {
  icon?: ReactNode;                  // defaults per accept kind: Upload / Music
  label?: ReactNode;
  hint?: ReactNode;
  busyLabel?: ReactNode;             // 'Reading files…'
  variant?: 'card' | 'compact' | 'strip';
  clickable?: boolean;
  /** Secondary action rendered under an OrDivider — the folder button. */
  secondaryAction?: ReactNode | 'folder-picker';
  /** Extra buttons inside the box (the /sng two-button grid). */
  actions?: ReactNode;
  className?: string;
}
```

`ChartDropZone` and `AudioDropZone` survive as ~15-line presets over `FileDropZone`, so their six and one call sites do not change at all:

```tsx
// components/chart-picker/ChartDropZone.tsx — unchanged public API
export default function ChartDropZone({onLoaded, disabled, id = 'chart-picker', className}) {
  return (
    <FileDropZone
      accept={['chart-package', 'folder']}
      pickerId={id} disabled={disabled} className={className}
      onChart={onLoaded}
      icon={<Upload className="h-8 w-8" />}
      label="Drop a .zip or .sng file here, or click to browse"
      busyLabel="Reading files..."
      secondaryAction="folder-picker"      // renders OrDivider + "Select a chart folder"
    />
  );
}
```

### 3.6 `SectionDropZone` after migration

Keeps its exact public API (`onAudioFile`, `onChartLoaded`, `disabled`, `children`, `className`); its 100 lines of drop logic collapse into `useFileIntake({accept: ['audio','chart-package','folder'], folders: 'handle', …})` plus the transparent-border wrapper. The nested-zone check moves into the hook, so it stops being a `SectionDropZone`-only concept.

### 3.7 Each call site after migration

| Call site | After |
|---|---|
| `SourcePicker` (drum-transcription) | Unchanged JSX; `AudioUploader` replaced by `<FileDropZone accept={['audio']} variant="card" label="Drag and drop an audio file here" hint="MP3, WAV, OGG, FLAC, or other browser-supported audio formats" clickable={false} actions={<Button variant="outline">Browse Files</Button>} onAudio={onFileSelected} />` inside the page's own `Card`. The grid-source `<p>` and the `Back` button stay in `SourcePicker`. |
| `TempoClient` | Same `FileDropZone` call as above via a shared `AudioFileZone` preset — and crucially **stops importing from `@/app/drum-transcription/…`**. `ChartDropZone` call unchanged. |
| `TrackEditPage` | Both cards unchanged in structure. `ChartDropZone` unchanged. `AudioDropZone` becomes a preset that keeps its decode-duration step as an `onAudio` handler wrapping `FileDropZone`. `OrDivider` import repoints to `components/file-intake`. |
| `DifficultyGenerationFlow` | `<ChartDropZone onLoaded={handleChartLoaded} id={dropZoneId} />` — **byte-identical**, its mock still works. |
| `AddLyricsClient` | `ChartDropZone` unchanged. `ReplaceChartButton` keeps its markup but drops its 60 lines of reader/AbortError glue for `const intake = useFileIntake({accept:['chart-package','folder'], pickerId:'add-lyrics-chart', onChart:onLoaded})` and calls `intake.openFolderPicker()` / `intake.openFilePicker()`. |
| `app/sng/DropZone` | `<FileDropZone accept={['any']} folders="walk" variant="compact" clickable={false} multiple label="Drag files or folders here to add them to the package" actions={<><Button>Select files</Button><Button>Add folder</Button></>} onFiles={…} />`. Its `readFileList` → `FileEntry[]` conversion stays in the page. |
| `StemsMixer` | Keeps its own markup entirely; adopts only `useFileIntake({accept:['audio'], folders:'files', multiple:true, pickerId:'chart-editor-add-stem', onFiles:addStemsFromFiles})` for `dropProps` + `openFilePicker`. Keyboard handling and the `h-7`/`h-16` switch stay local. |
| `AlbumArtField` | Keeps its markup and its inline error rendering; adopts `useFileIntake({accept:['image'], errorMode:'callback', onError:e => setError(e.message), onImage:accept})`. |
| `LocalChartLoader`, `/preview`, `/sheet-music` | No change. |

### 3.8 Explicitly NOT unified

| Thing | Why |
|---|---|
| `TrackEditPage`'s two-column Load/Create layout + "Start from scratch" | A product statement about the page, not a file-picking concern. |
| Error *rendering* (toast / inline `<p>` / bordered banner / field error) | The difficulty banner carries errors that never came from a file. Only classification is shared. |
| The grid-source copy on `/drum-transcription` | Explains a modeling consequence, correctly absent on `/tempo`. |
| `AlbumArtField`'s normalize-to-square-JPEG pipeline and preview-as-target design | A controlled form field in a dialog. |
| `StemsMixer`'s strip markup, keyboard handling, sequential multi-add | Sidebar constraints; the sequential loop exists for the name uniquifier. |
| `ReplaceChartButton`'s click-only shape | Deliberately avoids a second dashed box next to a loaded chart. |
| `LocalChartLoader`'s `requireDrums` / audio-presence checks | Chart *semantics*, one layer above file intake. |
| `ChartReviewClient`, `SpotifyHistory`, `useLibraryScan`, `local-songs-folder` folder pickers | Library/settings-scoped, not per-task selection. Migrating them buys nothing and risks the persisted-handle logic. |
| The `mode: 'readwrite'` SNG-converter picker | Exposed as `directoryMode` but left as the only caller; defaulting to `readwrite` would worsen the permission prompt everywhere. |

---

## 4. Migration Sequence

Seven steps, each a standalone commit that leaves the app working. No step rewrites more than one page's UI.

**Step 1 — `lib/file-intake/accept.ts`, additive only.** Create the module with the reconciled `AUDIO_EXTENSIONS` and `isAudioFile`. Change **no** call site. Add unit tests asserting the union covers every extension in all four current lists. *Verify:* `pnpm test`, `pnpm typecheck`. Zero runtime change.

**Step 2 — point the four audio lists at it, one commit per list, `AudioDropZone` last.** Each is a one-line diff. `AudioDropZone` last because it is the one whose list actually *narrows* today (§5.1) and is therefore the one that changes behavior. *Verify:* per list, drop a `.aac` and a `.wma` and confirm the intended accept/reject.

**Step 3 — `lib/file-intake/read-transfer.ts`, additive.** Port `SectionDropZone`'s handle path and `read-dropped-entries`'s walk path behind `readTransfer`. Then switch `SectionDropZone` and `app/sng/DropZone` to it. *Verify:* drop a folder on the `/tempo` card (handle path) and on the SNG editor (walk path, must still pull nested files); drop a `.zip`, a `.sng`, an audio file, and a `.txt` on each.

**Step 4 — `useFileIntake` + the widened `DropZoneShell`, then reskin `ChartDropZone` and `AudioDropZone` as presets.** Their public APIs do not change, so their seven call sites and their test mocks are untouched. **This is the riskiest step** — `ChartDropZone` has six consumers and is the single most-used control in the app. *Verify, on all six:* click-to-browse opens the right picker; drop `.zip`; drop `.sng`; drop a folder (still the "please drop a .zip or .sng" toast, unchanged); folder button opens the picker at the **remembered directory** (this is the regression most likely to be missed); cancel the picker and confirm no toast; disabled state on `TrackEditPage` and `SourcePicker` greys out and rejects both click and drop.

**Step 5 — `/tempo` and `/drum-transcription` audio zone.** Replace both `AudioUploader` usages with the shared `AudioFileZone` preset and delete `app/drum-transcription/components/AudioUploader.tsx`. Do these two together — they are the same component today, and splitting them means shipping the cross-page import for another commit. *Verify:* the `drum-transcription-home` test reaches the input **by type** (`input[type=file]`, per its comment at line 141), so keep a hidden input in the DOM; `TempoClient.test.tsx` asserts on `Pick a song file`, which lives in the page, not the zone. Manually: drag onto the zone, drag onto the section around it (nested-zone handoff — confirm only one handler fires and the outer highlight clears), click `Browse Files`, drop a `.txt` and check the wording of the rejection toast.

**Step 6 — the low-traffic adopters, one commit each:** `ReplaceChartButton`, `StemsMixer`, `app/sng/DropZone`, `AlbumArtField`. Each keeps its own markup and adopts only the hook. *Verify:* `/add-lyrics` replace-chart via both folder and `.zip` link; stem drop of two files at once (both must land with distinct names) and stem drop of a non-audio file; SNG editor drop of a nested folder; album art drop of a non-image (inline error, **not** a toast — and it must still distinguish `AlbumArtError` from an unexpected failure).

**Step 7 — move `SectionDropZone` under `components/file-intake/`, delete dead code, one docs pass.** Per the project's no-re-export-shim rule, update every import directly in the same commit.

**Explicitly not scheduled:** the difficulty pages need no work at all (their `ChartDropZone` call is byte-identical after step 4), and the settings-level folder pickers in §3.8 are out of scope.

**Rollback shape:** steps 4 and 5 are the only ones that can be user-visible. Both are single-commit reverts because the presets keep the old public APIs.

---

## 5. Risks & Open Questions

### 5.1 `AudioDropZone`'s narrower list may be deliberate — highest-confidence real risk

`AudioDropZone` accepts only `mp3, ogg, opus, wav, flac, m4a` and its comment says these are the "extensions Clone Hero packages carry, and that `decodeAudioData` can read." It feeds `TrackEditPage`'s create-a-chart flow, whose output is a Clone Hero package. `AudioUploader` accepts `aac, webm, wma` on top — but it feeds a transcription pipeline that decodes and re-encodes, so a format Clone Hero cannot ship is fine there.

**These may be two correct answers to two different questions:** "can we decode it?" vs "can the exported package carry it?". Widening `AudioDropZone` to the union would let a user start a chart from a `.wma` that the export pipeline then has to transcode — which `lib/chart-export/transcode-audio.ts` does handle, but its own list also lacks `wma`. **Do not silently widen this one.** Either keep two named lists (`DECODABLE_AUDIO` vs `PACKAGEABLE_AUDIO`) or confirm with the maintainer that transcode-on-export makes the distinction moot. Step 2 orders this last for exactly this reason.

### 5.2 `readChartDirectory` is non-recursive; `walkEntry` is

`readChartDirectory` reads only top-level files. `read-dropped-entries.walkEntry` recurses and flattens. A chart folder containing a subfolder is read differently depending on which door the user came through. Unifying to either behavior changes something: recursing everywhere could pull a nested unrelated album's `song.ogg` into a chart package; not recursing in `/sng` would break a documented feature there. **The plan keeps both, exposed as `folders: 'handle' | 'walk'`.** This is a deliberate non-unification and reviewers should push back if they think one is simply a bug.

### 5.3 The click-vs-drop asymmetry in `AudioUploader` may be intentional

In `AudioUploader` the dashed box is **not** clickable; only `Browse Files` is. In `ChartDropZone` and `AudioDropZone` the box **is** clickable and there is no button. Making all three consistent is tempting and is the kind of change users notice. `clickable` is a prop in the proposal specifically so migration can preserve today's behavior — but somebody should decide whether the inconsistency was a choice or an accident. **Recommendation: preserve exactly, decide separately.**

### 5.4 Picker `id`s are user-visible state

`showDirectoryPicker({id})` makes the browser remember a per-id directory. There are eight distinct ids in the app. Any typo or consolidation during migration silently resets a user's remembered folder — a regression with no error message and no test that can catch it. **Every `pickerId` must be copied literally**, and step 4's verification list calls out re-opening the picker at the remembered location.

### 5.5 `data-nested-dropzone` is a load-bearing global convention

It is a bare DOM attribute matched by `closest()`. Moving it from `DropZoneShell` onto `dropProps` is correct (it makes non-shell targets participate) but widens who has it. Two failure modes: a zone that *should* claim its drop loses the attribute (the section handles it too, double-firing); or an inner element gains it and swallows a drop the section should have routed. Only `/tempo` and `/drum-transcription` use `SectionDropZone` today, so blast radius is small — but there is no test for the nested handoff. **Recommendation: add one before step 4**, asserting a drop on a nested zone fires the nested handler exactly once and the section handler zero times.

### 5.6 Toast-vs-inline error is not purely presentational

`AlbumArtField` distinguishes `AlbumArtError` (bad file, user's problem) from anything else (a bug, different wording). No other selector makes that distinction — they all `e instanceof Error ? e.message : 'Failed to …'`. The `IntakeError.reason` field is meant to preserve this, but if a page passes `errorMode: 'toast'` and the shared component flattens a programming error into "Failed to read file," a real bug becomes invisible. **Open question: should `reason: 'read-failed'` with a non-`Error` cause `console.error` unconditionally?** The current code is inconsistent here (`StemsMixer` logs, `ChartDropZone` does not).

### 5.7 `SectionDropZone` is one session old

It has two consumers and, as far as this investigation found, no dedicated test. Making it the seed of the shared abstraction means promoting the least-exercised implementation. Its two clever mechanisms (sync capture before await; `closest()` on both `dragover` and `drop`) look correct on reading but have had the least real-world exposure. **Recommendation: do not build layers 3.3–3.5 on top of it until steps 3's manual verification has actually exercised the folder-drop path on a non-Chromium browser** — `getAsFileSystemHandle` is Chromium-only and the fallback path ("lands in the unrecognized toast rather than crashing") is untested.

### 5.8 Things I could not fully verify

- Whether `/preview` and `/sheet-music`'s `<details>`-collapsed `LocalChartLoader` has any drag interaction issue when collapsed — not exercised.
- Whether any e2e/browser test outside `__tests__/` drives these selectors.
- `app/chart-review/ChartReviewClient.tsx`'s IndexedDB-persisted handles interact with picker ids in a way this plan leaves alone by design, but the interaction was not traced end to end.

### 5.9 Cost/benefit, honestly

The unification removes roughly 250–300 lines of duplicated behavior and, more importantly, gives the four audio lists and the two folder strategies one place to be argued about. It does **not** make any page look different or work better on its own. If the team's appetite is limited, **steps 1, 2, and 5 alone** (one audio list; delete the cross-page `AudioUploader` import) capture most of the value at a fraction of the risk, and step 4 — the `ChartDropZone` reskin with six consumers — can wait.

---

## 6. Contrarian review

A second agent, loaded with the Contrarian persona (`~/projects/drum-to-chart/.claude/agents/contrarian.md`, rigor and structure adapted from ML-research-phase review to a frontend refactor plan), reviewed this plan against the actual code before it was scheduled. Verbatim critique:

### Contrarian critique — selector unification plan

**Strongest pro**: The catalog is unusually accurate. Spot-checks of `DropZoneShell` (77 lines), `ChartDropZone` (149), `AudioDropZone` (125), `AudioUploader` (120), `SectionDropZone`, `StemsMixer:330–410` all confirmed — every line count, prop shape, extension list, toast string, and the "6 consumers" count for `ChartDropZone` check out exactly. The `ChartDropZone`/`AudioDropZone` preset promise is real: their prop shapes (`onLoaded/disabled/id/className`, `onDropped/disabled/className`) map onto the proposed `FileDropZoneProps` without churn, and no call site passes anything else. §2.2 and §3.8 are the strongest parts — the plan resists unifying error *rendering* and the two folder-walk strategies, which is the right call.

**Strongest con**: §5.1 flags the wrong list as the dangerous one, and step 2 will ship a real export regression. `AudioDropZone` gates on `decodeAudioData` *after* the extension check (`AudioDropZone.tsx:53` → `:66`), so widening its list cannot admit an undecodable file — worst case is worse error copy. Meanwhile step 2 also repoints `lib/chart-export/transcode-audio.ts`'s `AUDIO_EXTENSIONS`, adding `wma`. That flips `.wma` from silent pass-through to `needsOpusTranscode → decodeAudio`, which throws in Chrome. The plan orders `AudioDropZone` last "because it's the risky one"; it's the safe one.

**Risk flags**:
- [evidence] §5.4 claims "eight distinct ids"; actual count is 11–12 (`clone-hero-songs` ×2, `chart-review-charts/-results`, `sng-convert-folder/-add-files/-add-folder/-modify`, `spotify-dump`, `add-lyrics-chart`, `chart-editor-add-stem`, default `chart-picker`) — plus `DifficultyGenerationFlow`'s *dynamic* `dropZoneId`, which "copy literally" doesn't cover.
- [accessibility] `DropZoneShell.tsx:43` is a bare `<div>` with `onClick` — no `role`, `tabIndex`, or `aria-label`. §3.4's widened props add `variant`/`actions`/`clickable` and no a11y at all, so the gap is preserved across all 13. Worse, `DifficultyGenerationFlow.test.tsx:113` mocks it as `getByRole('button', {name:'drop chart'})` — a role the real component doesn't have, so the suite actively masks it. `StemsMixer` already proves the fix is ~4 lines.
- [verification] Only three test files in the repo call `fireEvent.drop`, all synthetic `{dataTransfer:{files:[file]}}` — none touch `ChartDropZone`, `SectionDropZone`, or `AudioUploader`. jsdom has no `dataTransfer.items` or `getAsFileSystemHandle`, so the two mechanisms most likely to break (sync-capture-before-await, folder handles) are **unreachable by any test the plan proposes**, including §5.5's. Step 4 is a 6-site × 6-case manual matrix with no automation and no OS-level drag named.
- [scope] Nothing named `Enter`/`Space` support as a shared concern in §2.1 despite §1.9 identifying it as unique.
- [sequencing] `.claude/worktrees/how-it-works/` has a 7th `ChartDropZone` site (`app/drum-edit/DrumEditClient.tsx:274`) absent from the catalog — parallel in-flight work will collide with step 4.
- [metric] §5.9's "250–300 lines" is the only quantified goal. No zero-regression definition, no "a 14th selector costs X", and no acceptance check after step 7.
- [don't-section] §5.4's picker-id rule is prose only. Make `pickerId` required and add a test asserting the literal id set.

**Suggested edits**:
- Split step 2: `transcode-audio.ts` gets its own carve-out (`PACKAGEABLE_AUDIO` ⊂ `DECODABLE_AUDIO`), never the union. Reorder so `AudioDropZone` is *first*, transcode last or never.
- Add `role="button" tabIndex={0}` + `aria-label` + Enter/Space to `DropZoneShell` in step 4, and un-mock `ChartDropZone` in the difficulty test.
- Add a "done" gate to step 7: all 13 keyboard-operable, one id-inventory test green, manual OS-drag pass on Chromium + one non-Chromium.
- Adopt §5.9's reduced scope (1, 2, 5) as the default, with the transcode split above.

**Verdict**: PROCEED WITH EDITS
