# 0084 — One project model, /chart-editor as the landing page, and charts with no audio

Status: todo

Owner ask, verbatim:

> "We need to change the data model for our tools like drum-transcription.
> These pages should be entrypoints, but the resulting page you land on should
> be /chart-editor. And when you go to the chart editor landing page, you should
> see the existing projects regardless of entrypoint. Ideally if you go to the
> drum transcription home page you see only the projects started from drum
> transcription."

> "The chart editor landing page needs to have a way to create a new chart. When
> you create a new chart it starts without an audio file. The stems section
> should have a null state UI that says drag an audio file there."

**Scope honesty up front.** This is two plans' worth of work. It is written as
five phases; Phases 1-2 (project model + landing/routing) are one shippable
unit, Phases 3-4 (blank chart + attach audio) are a second, and Phase 5 (layout
convergence) is its own plan. Every phase is independently landable and green.

---

## 1. The problem, with evidence

### 1a. There are two OPFS project stores with different shapes

| | `/chart-editor` | `/drum-transcription` |
| --- | --- | --- |
| Module | `lib/project-storage/opfsProjectStore.ts` | `lib/drum-transcription/storage/opfs.ts` |
| Shape | factory `createOpfsProjectStore(namespace, {legacyNamespaces})` | module-level functions, `const NAMESPACE = 'drum-transcription'` |
| Namespaces | `chart-editor`, adopting `drum-edit`/`guitar-edit`/`bass-edit` read/write in place (`ChartEditorClient.tsx:14`) | `drum-transcription` only |
| Record fields | `id, name, artist, charter, createdAt, updatedAt, durationSeconds, sourceFormat, originalName, sngMetadata, audioAnchor, stemFingerprint, assistProvenance` | `id, name, createdAt, updatedAt, durationSeconds \| null, stage, gridSource, stemFingerprint, audioAnchor, assistProvenance` |
| Chart on disk | `notes.chart` + `notes.edited.chart` (always `.chart`; `TrackEditPage.tsx:252` forces `format = 'chart'`) | `notes.chart`/`notes.mid` + `.edited.` sibling (`CHART_FILE_BASENAMES`, `findProjectChartFile`) |
| Audio on disk | `audio/<the package's own files, verbatim>` | `audio/song.opus` + `audio/meta.json` (legacy: `audio/full.pcm`, `audio/original.<ext>`) |
| Root files | any non-audio package file, verbatim (`song.ini`, album art) + an `original-files.json` manifest | `decoded-onsets.json`, `package-info.json`, `assets/` + `assets-manifest.json` |
| Editor host | `TrackEditPage.TrackEditEditor` | `app/drum-transcription/components/EditorApp.tsx` |

`original-files.json` is written by `createProject` but has no live reader:
`loadFilesForExport` (`opfsProjectStore.ts:445`) is exported and referenced
nowhere outside the module itself (verified by grep across `app/`, `components/`,
`lib/`). It is listed above for completeness, not as a constraint. Nothing in
this plan needs to read it, and `createBlankProject` writes whatever
`createProject` writes without caring.

The overlap is not small: `audioAnchor`, `assistProvenance` and `stemFingerprint`
are the same three fields, mirrored out of the same `ChartDocument`, persisted by
two near-identical `saveFn`s (`TrackEditPage.tsx:480-497` vs
`EditorApp.tsx:169-208`), and re-attached by two near-identical load paths
(`TrackEditPage.tsx:539-547` vs `EditorApp.tsx:313-334`).

The two landing screens are also duplicates: `TrackEditPage.tsx:325-441` and
`DrumTranscriptionClient.tsx`'s "Existing Projects" card render the same
list-plus-delete-dialog against different stores, with different subtitle text
(`artist · date` vs `stage · date`).

The stem cache is already shared and namespace-independent
(`lib/audio-pipeline/stem-cache.ts:28`, `NAMESPACE = 'audio-pipeline'`), so
nothing about stems constrains this. The header comment in
`lib/drum-transcription/storage/opfs.ts` still describes the cache as living
under `drum-transcription/`; it does not.

### 1b. The two stores' projects are invisible to each other

`TrackEditPage`'s `listProjects()` reads `chart-editor` + the three adopted
legacy namespaces. `DrumTranscriptionClient`'s `listProjects()` reads
`drum-transcription`. Neither can see the other, so a chart the user transcribed
is unreachable from `/chart-editor`, which is the editor the owner wants people
to land in.

### 1c. A drum-transcription project is not always openable

`createProject(name)` (`storage/opfs.ts:210`) writes `stage: 'uploaded'` and
`durationSeconds: null` **before any audio, stems or chart exist**. The pipeline
walks `stage` through `separating` → `transcribing` → `editing`
(`pipeline/runner.ts:160, 200, 275, …`). A project whose tab was closed during
Demucs separation sits at `separating` with no `notes.chart` on disk.

`DrumTranscriptionClient.checkProjectStage` (`:198-237`) exists for exactly
this: if `stage` is not `editing`/`exported` it mounts `ConnectedProcessingView`
and issues `startRun({kind: 'resume', projectId})`. `handleSelectProject`
(`:344`) does the same from the list. **This is the only resume path in the
app**, and any routing change has to keep it reachable (D3).

### 1d. `/tempo` and `/add-lyrics` are entrypoints with no project at all

`app/tempo/TempoClient.tsx` and `app/add-lyrics/AddLyricsClient.tsx` import no
storage module (verified: no `opfs`/`project-storage` import in either). They
hold everything in memory for the visit and end at a download. Converting them
is a redesign of each, is the owner's ask only by implication, and is out of
scope here (§11).

### 1e. The chart editor structurally cannot open a project with no audio

Five hard stops, in order along the load path:

1. `TrackEditPage.tsx:233` — import throws `'No audio files found in chart package'`.
2. `TrackEditPage.tsx:588` — load throws `'No audio files found in project storage'`.
3. `decodeChartPackageAudio` (`hooks/projectAudio.ts`) throws
   `'Could not decode any of this project's audio files'` on an empty list.
4. `usePaddedAudio`'s effect guard is
   `if (!chartDoc || !audioMeta || !fullMixPcm) return;` (`:265`). All three are
   null on an audio-less project — `audioMeta` because `TrackEditPage.tsx:711`
   passes `packageAudio ? PACKAGE_AUDIO_META : null`. So `audioManager` stays
   `null` and `TrackEditPage.tsx:799-801` renders `null` forever (a blank screen,
   no error).
5. `AudioManager`'s constructor computes
   `Math.max(...Object.values(this.#tracks).map(t => t.duration))`
   (`lib/preview/audioManager.ts:97-100`). With zero tracks that is `-Infinity`,
   which then flows into `duration`, the transport readout, and every seek clamp.

`ChartEditor`'s prop is `audioManager: AudioManager` (non-optional), and it is
handed to `HighwayEditor`, `TransportControls`, `PianoRollTimeline`,
`LeftSidebar` → `StemsMixer`, and `useLoopRegionSync`. So "no audio" cannot be
expressed as "no AudioManager" without touching all of them.

### 1f. The stems section has no null state and `/chart-editor` cannot take a drop

`StemsMixer` bails with `if (trackNames.length === 0) return null;` (`:262`). Its
drop-a-file row renders only when the host passes `onAddStem`, and today only
`EditorApp` does (`EditorApp.tsx:758`); `TrackEditPage.tsx:823` passes
`stemsMixer={{stemOrigins: paddedStems}}` and nothing else. So on `/chart-editor`
there is no way to add audio to a project at all.

Worse, `onAddStem`'s contract is PCM-only: `addStemFromFile`
(`StemsMixer.tsx:221-241`) decodes the `File`, interleaves it, and calls
`onAddStem({name, pcm, origin})`. The original bytes are gone by then, and
`EditorApp.handleAddStem` (`:461-473`) is `setUserAddedStems(prev => [...prev,
input])` — session-only, never persisted. Attaching audio *durably* therefore
requires a contract change, not just a new handler (D8).

---

## 2. Core decisions

### D1 — One logical project model, one read/lifecycle facade, two on-disk layouts, no bulk copy

A **project record** is:

```ts
// lib/project-storage/types.ts
export type ProjectOrigin = 'chart-editor' | 'drum-transcription';

/** Which on-disk shape a project's directory has. */
export type ProjectLayout = 'chart-package' | 'drum-transcription';

export interface ProjectRecord {
  id: string;
  /** OPFS namespace the directory actually lives in. */
  namespace: string;
  layout: ProjectLayout;
  origin: ProjectOrigin;
  name: string;
  artist: string;
  charter: string;
  createdAt: string;
  updatedAt: string;
  /** Nominal chart length. Null on a drum-transcription project whose audio
   *  has not been decoded yet (`storage/opfs.ts:89` types it nullable and
   *  `createProject` writes null). */
  durationSeconds: number | null;
  /** False for a project created with no audio and never given any (D6). */
  hasAudio: boolean;
  /**
   * False when the project's directory does not yet hold an openable chart,
   * i.e. a drum-transcription project whose pipeline has not reached
   * `editing`. Opening such a project resumes the pipeline; it does not
   * mount an editor (D3, §1c).
   */
  ready: boolean;
  /** The drum-transcription pipeline stage, when this project has one. Null
   *  for `chart-package` projects, which have no pipeline. */
  pipelineStage: ProjectStage | null;
}
```

`lib/project-storage/projects.ts` is the single module the app **lists, resolves,
renames, deletes and creates** projects through. It resolves an id by scanning
the namespaces it knows, normalizes whichever `metadata.json` it finds into a
`ProjectRecord`, and dispatches lifecycle writes back to the store that owns that
layout. Nothing is copied or moved. Ever.

It is explicitly **not** a proxy for per-field domain writes. The five live
`updateProject` callsites (`TrackEditPage.tsx:490` autosave mirror, `:682`
fingerprint, `:764` metadata; `EditorApp.tsx:200` and `:516`; the whole
`pipeline/runner.ts`) keep calling their own store directly, because the fields
they write (`audioAnchor`, `assistProvenance`, `stemFingerprint`, `stage`,
`gridSource`) are layout-specific and unifying them is Phase 5. The facade is the
authority on *which projects exist and what they are*, not on every byte written
into one. D2 is written to be correct under that constraint.

**Why not one physical layout now?** Because migrating a drum-transcription
project means copying `audio/song.opus` (tens of MB), possibly `audio/full.pcm`
(hundreds of MB for legacy projects), `decoded-onsets.json`, `assets/`, and the
chart, with no transaction and no rollback. A half-copied project is a lost
project, and the owner named losing work as unacceptable. The precedent for
adopt-in-place is already in this file: `getReadableNamespaceDirs` +
`openProjectDir` (`opfsProjectStore.ts:110-171`) exist precisely so
`/drum-edit`'s projects stayed editable without a copy.

Convergence onto one layout is Phase 5, and it is severable.

### D2 — `origin` is written at creation and derived on read when absent

`ProjectOrigin` is written into `metadata.json` at creation by whichever
entrypoint created the project. For a project created before the field existed,
`projects.ts` derives it on read:

- layout `drum-transcription` → `'drum-transcription'`
- layout `chart-package` → `'chart-editor'`

There is **no opportunistic backfill**. Per D1 the facade does not intercept the
domain writes that would carry one, so a backfill claim would be a claim nothing
executes. The derivation is permanent for legacy rows and correct for them,
because today the two namespaces *are* the two entrypoints. The field is stored
for *new* projects so that Phase 5 (a drum-transcription project living in the
canonical layout) does not silently relabel them.

Alternative C (derive only, never store) is not taken for that reason alone; the
cost of storing it is one JSON key.

### D3 — `/chart-editor?project=<id>` is the editor URL; `/drum-transcription?project=<id>` stays the pipeline-resume URL

- The query parameter stays `?project=`. Both hosts already read it
  (`TrackEditPage.tsx:171`, `DrumTranscriptionClient.tsx:102`), the
  `/drum-edit` → `/chart-editor` redirects in `next.config.js:41-53` preserve it,
  and links exist in the wild. A path segment (`/chart-editor/[projectId]`) buys
  nothing here and costs a routing rewrite plus a second `Suspense` boundary.
- Entrypoints hand off with `router.push('/chart-editor?project=' + id)`, not
  `replace`. Browser Back then returns to the entrypoint, which is what a user
  who just ran a transcription expects.
- **The redirect is conditional on `ready`.** `DrumTranscriptionClient` keeps
  `checkProjectStage` exactly as it is. When the stage check says the project is
  ready (`editing`/`exported`), it `router.replace`s to
  `/chart-editor?project=<id>`. When it says the project needs pipeline work, it
  does what it does today: mount `ConnectedProcessingView` and
  `startRun({kind: 'resume'})`, then push to `/chart-editor?project=<id>` on
  success. A blanket redirect would delete the only resume path in the app
  (§1c), stranding every interrupted separation with an unopenable project.
- **`/chart-editor` never mounts an editor on a non-ready project.** If
  `record.ready` is false it `router.replace`s to
  `/drum-transcription?project=<id>`, which owns the pipeline UI. The two
  redirects cannot loop: their conditions are exact complements of each other,
  evaluated from the same `stage` field.
- The landing list marks non-ready rows (D5) so Open is never a surprise.
- The editor's own "Back to Projects" control always goes to `/chart-editor`. It
  is a "show me my projects" affordance, and per the owner `/chart-editor` is the
  list that shows everything. The browser's Back button is what returns to a
  specific entrypoint.

### D4 — `/chart-editor` mounts the right editor host from `record.layout`

`chart-package` → today's `TrackEditEditor`. `drum-transcription` → today's
`EditorApp`. Both already render `ChartEditor` inside
`AudioServiceProvider` / `AssistRunnerProvider` / `ChartEditorProvider`
(`TrackEditPage.tsx:123-143`, `DrumTranscriptionClient.tsx`'s editor branch), so
the provider stack is hoisted into a shared `ChartEditorRoute` component and each
host becomes a leaf.

This is deliberately not "merge the two hosts". They differ in export sources
(`EditorApp.getAudioSources` has the `includeStems` Opus branch and the verbatim
passthrough; `TrackEditPage.getAudioSources` pads the package's own files),
in Chart Assist wiring (`projectId` + `allowDrumRerun` vs `loadAudio` only), in
chart format (`.mid` possible vs `.chart` forced) and in the decoded-onsets and
vocals-stem loads. Merging them is Phase 5's job, after the routing is settled.

### D5 — The landing list is one component, filtered by origin

`components/project-list/ProjectList.tsx` renders `ProjectRecord[]` with open /
rename / delete. `/chart-editor` passes every record; `/drum-transcription`
passes `records.filter(r => r.origin === 'drum-transcription')`. One
implementation, two filters. The duplicated list markup in
`TrackEditPage.tsx:352-408` and `DrumTranscriptionClient.tsx`'s card both go.

A row with `ready: false` shows a "Needs processing" state in place of the
artist subtitle, and its Open button reads "Resume" and routes per D3.

### D6 — A new chart is a real project with `hasAudio: false` and a silent transport

Creation writes a normal project record and a normal `notes.chart` + `song.ini`
(D7). The editor opens it through the same path as any other project, with one
difference: the `AudioManager` is built from the synthesized metronome click
alone. The click WAV already spans the whole chart
(`generateBeatClickTrackWav(parsedChart, durationMs, chartDelayMs)`), so the
manager has exactly one track, a real duration, a working transport, and working
seek. Nothing downstream has to learn about "no audio" except the things that
genuinely need audio (§5).

Rejected alternative: a zero-filled full-mix PCM buffer. Five minutes of
44.1 kHz stereo `Float32` is ~105 MB, and `usePaddedAudio` deliberately retains
the original *and* the padded copy (see its header comment), so it is ~210 MB for
silence.

### D7 — `writeChartFolder` already emits the `song.ini` that carries `song_length`

Verified by running the round trip:
`writeChartFolder({parsedChart: createEmptyChart({format: 'chart', resolution: 480}), assets: []})`
with `metadata = {name, artist, charter, song_length: 300000}` returns **two**
files — `notes.chart` (whose `[Song]` block carries Name/Artist/Charter/Resolution
and *not* `song_length`) and `song.ini`:

```
[song]
name = Blank
artist = A
charter = C
song_length = 300000
```

That closes the whole problem, with no new code:

- `opfsProjectStore.createProject` writes every non-audio, non-chart file in
  `allFiles` at the project root (`:246-251`), so `createBlankProject` passes
  `writeChartFolder`'s own output as `allFiles` and the ini lands on disk.
- `readSongIni` (`:387`) reads it back case-insensitively.
- `TrackEditEditor`'s load step 3 (`TrackEditPage.tsx:530-536`) already overlays
  it with `withSongIniFields`, which spreads `ini.metadata` wholesale
  (`lib/chart-editor-core/songIniMetadata.ts:58-68`) — `song_length` included.

So `song_length` is the **single** source of truth for an audio-less chart's
length, in a file that already round-trips today. There is no `metadata.json`
duration mirror and **no ordering dependency on plan 0080** (§7).

`ProjectRecord.durationSeconds` remains a display denormalization for the list
row, written at creation from `song_length` and rewritten when audio is attached
(§6d) — the same denormalization role `name`/`artist` already play. It is never
read by the editor.

The blank chart's `song_length` default: 300000 ms (5 minutes), stated as an
exported constant. It only governs how far the beat grid runs before audio
arrives. Making it editable in the song-details dialog is out of scope (§11).

### D7b — This plan owns `song.ini` persistence; plan 0080 is folded in

Owner decision, 2026-08-05. Plan 0080 is the design record for persisting a
real `song.ini` per project; its decisions D1 through D5 are implemented as a
phase here rather than as a separate round, because this plan's storage work
had already built the first third of them incidentally and two owners would
produce two schemas.

What already exists at HEAD, and is not in scope to rebuild: `writeSongIni`
and `readSongIni` on the project store, and `withSongIniFields` overlaying the
ini onto the document in `TrackEditPage`'s load path.

What folding 0080 in actually adds:

1. **Write the ini on every save, not only at creation.** Today
   `writeSongIni` is called once, at project creation. An album or difficulty
   the user edits afterwards never reaches disk, so it is lost on reload. This
   is the gap that makes the current state worse than not persisting at all:
   the code reads as though persistence works.
2. **Replace the wholesale overlay with 0080's D2 merge.** `withSongIniFields`
   spreads `ini.metadata` in full. That is unsafe once the ini is rewritten on
   every save, because `writeIniFile` omits fields equal to scan-chart's
   defaults while `extractSongMetadata` fills every key on read, so a
   round-tripped ini contributes `"Unknown Artist"` where the user set nothing
   and overwrites the chart's real value on the second load. Strip
   scan-chart's defaults first (default means unset), then let the chart file
   win on the fields it can express. `readChart`'s own ini-wins semantics stay
   unchanged for every non-project route.
3. **0080's D4 and D5**: seed the dialog's identity from the document rather
   than the project record, and treat `ProjectMetadata.name`/`artist`/
   `charter` as a display denormalization refreshed on save.

D7 above is unaffected: `song_length` round-trips through the same file and
still needs no new code.

**Shipped.** `chartDocToFolderFiles` (`lib/chart-edit/folder-files.ts`) is the
one seam both hosts serialize through, so the chart file and the `song.ini`
beside it always come from a single `writeChartFolder` call on a single
document; `chartDocToChartText` is now a consumer of it. `TrackEditPage`'s
autosave writes the ini through `store.writeSongIni` and `EditorApp`'s writes
it through `writeProjectBinary(SONG_INI_FILE_NAME)`, ini first in both, and
`EditorApp`'s load path merges it back (a project with no ini on disk loads
from its chart exactly as before).

`withSongIniFields` is now 0080's D2 merge rather than a wholesale spread: it
strips scan-chart's defaults first (`defaultIniMetadata` derives the table at
runtime, since the fork does not export `defaultMetadata`) and then lets every
field the chart file defines win. `readChart` is unchanged, so every non-project
route keeps ini-wins. `TrackEditPage` seeds the song-details dialog from the
document with the record as fallback (D4), and both hosts mirror the document's
identity into the record on every save (`documentIdentityFields`, D5).

Tests: `lib/project-storage/__tests__/songIniPersistence.test.ts` drives the
round trip through the real store and a fake OPFS — two full save/reload
cycles, a cleared field, a project with no ini, and the legacy edited-project
migration case. The second cycle is the one that fails against a wholesale
overlay (verified by reverting the strip: charter comes back as
`"Unknown Charter"`).

### D8 — Attaching audio is a drop on the stems section; `onAddStem` gains the source bytes

Persisting a dropped file needs the file's own bytes. Re-encoding the decoded PCM
to WAV would turn a 4 MB mp3 into a ~50 MB `song.wav` per project, and the bytes
are right there in `addStemFromFile`. So `onAddStem`'s input widens to carry
them:

```ts
onAddStem?: (input: {
  name: string;
  pcm: Float32Array;   // interleaved 44.1k stereo, as today
  origin: 'user-added';
  /** The dropped file, verbatim, for hosts that persist it. */
  file: {fileName: string; data: Uint8Array};
}) => void;
```

One contract, both hosts, and the persistence itself lives in one shared helper
(`lib/project-storage/attachAudio.ts`) so there is exactly one writer of a
project's `audio/` directory from a drop. `TrackEditEditor` calls it. `EditorApp`
keeps its session-only behavior in Phase 4 and adopts the helper in Phase 4b or
Phase 5 — it is the same function either way, so this is not Alternative A's "two
writers on one logical concept", it is one writer with one adopter today.

§6 covers the null state, the full-mix rule and the timing consequences.

---

## 3. Alternatives considered and rejected

**A. Two stores kept in sync, with an index in one of them.** Two writers on one
logical record, drift is invisible (nothing reads both and compares), and the
first bug is a project that appears in one list and not the other. Rejected.

**B. One store, hard migration on first load.** Copy every drum-transcription
project into the chart-editor namespace. Rejected under D1: no transaction, very
large payloads, and the failure mode is data loss.

**C. Derive `origin` from the namespace, no stored field.** Correct today, wrong
the moment a project's layout and its origin decouple (Phase 5). Kept as the
*read* fallback for legacy records (D2), not as the model.

**D. `/chart-editor/[projectId]` route segment.** Rejected under D3. Recorded
because it is the more conventional shape and worth revisiting if the editor ever
needs per-project server rendering, which it does not (everything is OPFS).

**E. A separate "no audio" editor mode with the audio UI hidden.** Rejected:
the moment a file is dropped it has to become the normal editor anyway, so a
second mode is a second code path that exists only until the user uses the
feature.

**F. Merge `EditorApp` and `TrackEditEditor` first, then do routing.** Rejected as
ordering: the merge is the largest and riskiest change here, and none of the
owner's asks depend on it. It is Phase 5.

**G. Mirror `song_length` into `metadata.json` and sequence this plan behind
0080's ini writer.** Rejected on evidence: `writeChartFolder` already emits a
`song.ini`, and the store already writes, reads and overlays it (D7). The mirror
would be a second source of truth for one number, and the sequencing would be a
dependency on work that is already done in a library.

---

## 4. Data model and API changes

### 4a. `lib/project-storage/` (new modules, no re-export shims)

- `types.ts` — `ProjectRecord`, `ProjectOrigin`, `ProjectLayout` (§D1).
- `projects.ts` — the facade:

```ts
listProjects(): Promise<ProjectRecord[]>            // both layouts, dedup by id, updatedAt desc
findProject(id): Promise<ProjectRecord | null>
renameProject(id, {name, artist, charter}): Promise<ProjectRecord>
deleteProject(id): Promise<void>
createChartPackageProject(opts): Promise<ProjectRecord>   // wraps today's createProject
createBlankProject(opts): Promise<ProjectRecord>          // Phase 3
```

`listProjects` iterates a registry of `{namespace, layout, adapter}` entries:
`{chart-editor, drum-edit, guitar-edit, bass-edit}` → `chart-package`,
`{drum-transcription}` → `drum-transcription`. Dedup and sort keep
`opfsProjectStore.listProjects`'s existing semantics (primary namespace shadows a
duplicate id; `updatedAt` descending).

The `drum-transcription` adapter maps `stage` to
`ready = stage === 'editing' || stage === 'exported'` and passes `stage` through
as `pipelineStage`. The `chart-package` adapter sets `ready: true` and
`pipelineStage: null` — that layout has no pipeline, and its directory always
holds a chart from creation.

`ProjectSummary` in `storage/opfs.ts` already carries `stage` (`:151`), so the
adapter needs no extra read per project.

### 4b. `lib/project-storage/opfsProjectStore.ts` — `ProjectMetadata` gains

```ts
origin?: ProjectOrigin | undefined;   // absent => 'chart-editor' (D2)
hasAudio?: boolean | undefined;       // absent => true (every existing project has audio)
```

`createProject` writes both. Nothing else in that module changes in Phase 1.

### 4c. `lib/drum-transcription/storage/opfs.ts` — `ProjectMetadata` gains

```ts
origin?: ProjectOrigin | undefined;   // absent => 'drum-transcription' (D2)
artist?: string | undefined;          // for the unified list; absent on existing projects
charter?: string | undefined;
```

`hasAudio` is not added here: this layout's pipeline always stores audio before
it writes a chart (`runner.ts:129-137`), so it is unconditionally `true`.

**`EditorApp.handleMetadataChange` is fixed in this plan, in Phase 2.** Today
(`EditorApp.tsx:513-521`) it writes
`updateProject(projectId, {name: artist.trim() ? \`${name} by ${artist}\` : name})`,
composing the artist into the project name. Left alone, that actively undoes
§8's rename on the next save from the editor. Since §4c is already adding
`artist`/`charter` to this record, the handler becomes
`updateProject(projectId, {name, artist, charter})` — a three-line change that
belongs with the fields it depends on, not deferred to 0080.

Existing drum-transcription projects still carry a composed `"Song by Artist"`
in `name` and no `artist`. The list shows that composed string as the title with
an empty artist until the user next saves song details, at which point the row
self-heals. Not worth parsing composed names back apart.

### 4d. `lib/chart-edit/` — blank chart construction

Extract from `lib/tempo-map/build-chart.ts` (which becomes a caller, per the
"don't duplicate code" rule, in its own commit):

```ts
export function createBlankChartDocument(opts: {
  name: string;
  artist?: string;
  charter?: string;
  songLengthMs: number;
  resolution?: number;   // default: scan-chart's 480
  bpm?: number;          // default 120
  timeSignature?: {numerator: number; denominator: number}; // default 4/4
}): ChartDocument;
```

It is `createEmptyChart({format: 'chart'})` (verified: `resolution 480`,
one tempo at tick 0 of 120 BPM, one 4/4 time signature, `trackData: []`,
`metadata: {}`), wrapped as `{parsedChart, assets: []}`, plus:

- `trackData: [emptyTrack({instrument: 'drums', difficulty: 'expert'})]`, using
  `lib/chart-edit/empty-track.ts`. Exactly one track, because
  `TrackEditPage.tsx:224-229` rejects a chart with no supported track
  (`NO_SUPPORTED_TRACK_MESSAGE`), and `TrackEditPage.tsx:555-556` prefers drums
  when seeding the active scope. Every other instrument is one click away in the
  Chart Matrix's "+ Add instrument" (`sidebar/ChartMatrix.tsx:149-151`,
  `AddTrackCommand`).
- `metadata: {name, artist, charter, song_length: songLengthMs}`.

Difficulties: Expert only at creation. The Chart Matrix's per-row generate
affordance already produces the lower ones from Expert and needs no audio, so
seeding four empty difficulties would just create three tracks the matrix shows
as charted-but-empty.

`createBlankProject` then calls `writeChartFolder` on that document and hands
`createProject` `chartText` (the `notes.chart` text), `audioFiles: []`, and
`allFiles: <writeChartFolder's two files>`, which puts `song.ini` at the project
root (D7).

### 4e. `components/chart-editor/hooks/usePaddedAudio.ts` — two changes

**(1) A silent-project build.** `fullMixPcm: Float32Array | null` already exists
as a param; today a `null` means "not loaded yet" and the effect returns early.
Add an explicit third state:

```ts
/** Build a click-only AudioManager spanning `silentDurationSeconds` when the
 *  project has no audio. Mutually exclusive with `fullMixPcm`. */
silentDurationSeconds?: number | undefined;
```

`buildPaddedAudioManager` takes `fullMixPcm: Float32Array | null` and a duration,
skips the full-mix WAV when it is null, and derives `durationMs` for the click
from the supplied duration instead of from the padded mix's length.

The effect's entry guard `if (!chartDoc || !audioMeta || !fullMixPcm) return;`
(`:265`) becomes: return unless there is a `chartDoc` **and** either
(`audioMeta` and `fullMixPcm`) or `silentDurationSeconds`. On a silent project
`audioMeta` is null (`TrackEditPage.tsx:711` passes it only when `packageAudio`
exists), and the pad computation `anchorPadSamples(anchor, audioMeta.sampleRate)`
needs a sample rate, so the silent branch uses the click's own 44100 constant.

**(2) `BuildTarget` must cover the full mix and the duration.** Today
(`:60-64`) it is `{padSamples, stems}` only, and the effect short-circuits on

```ts
if (target && target.padSamples === nextPadSamples && stemsEqual(target.stems, stems)) return;
```

`fullMixPcm`, `fullMixName` and the click's duration are not in it. Without a
change, attaching audio to a blank project (full mix `null` → buffer, `stems`
and `padSamples` unchanged) would hit that guard and **no rebuild would happen** —
a dropped mp3 that silently does not play. Same gap for the §6d `song_length`
rewrite: the click track would keep reporting 5:00 for a 3:20 song. So:

```ts
interface BuildTarget {
  padSamples: number;
  stems: ReadonlyArray<AudioStemInput>;
  fullMixPcm: Float32Array | null;   // compared by reference, like stem PCM
  fullMixName: string;
  silentDurationSeconds: number | undefined;
}
```

with the comparison extended accordingly. This is a real change to the gating
logic and gets its own test (§10.15): a rebuild fires when only the full mix
changes, and does not fire when nothing changes.

### 4f. `lib/preview/audioManager.ts`

`this.#duration = Math.max(...)` over an empty track map yields `-Infinity`.
Guard it to `0`. This is defensive (D6 guarantees at least the click track) and
one line, but `-Infinity` propagating into seek clamps is the kind of failure
that shows up as a frozen playhead with no error.

---

## 5. The blank chart: every consumer of audio, and what it does

This is the section most likely to produce crashes, so it is exhaustive against
the current code.

| Consumer | Today | With no audio |
| --- | --- | --- |
| `TrackEditEditor` load step 5 (`:585-590`) | throws on empty `audioFiles` | branch on `record.hasAudio`; skip steps 5-6 entirely |
| `decodeChartPackageAudio` | throws on empty list | not called |
| `usePaddedAudio` | needs `chartDoc` + `audioMeta` + `fullMixPcm` | `silentDurationSeconds` branch (§4e) |
| `AudioManager` | `-Infinity` duration with 0 tracks | one track (click); plus the §4f guard |
| `ChartEditor.audioManager` | required | unchanged, always non-null |
| `ChartEditor.durationSeconds` | `audioDurationSeconds \|\| projectMeta.durationSeconds` | click duration == `song_length` (D7) |
| `TransportControls` | polls `audioManager.currentTime`, shows `/ durationSeconds` | works; Play plays the click |
| Click volume | `defaultVolumeFor` returns 0 for `CLICK_TRACK_NAME` (`sidebar/mixerBus.ts`) | **decision needed**: seed the click above 0 on a no-audio project, or Play is silent with no explanation. Proposed: `defaultVolumeFor(name, {silentProject})` returning 70 for the click when the project has no audio, with a unit test for both branches |
| `HighwayEditor.audioData` | optional | undefined; the waveform surface is absent. **Must verify** `components/chart-editor/highway/HighwayLane.tsx` and `lib/preview/highway/stage.ts` handle undefined PCM without a blank highway (they take it as optional today, but this is unexercised) |
| `PianoRollTimeline.audioData` | optional (`wavePcm`) | undefined; no waveform row background |
| `PianoRollTimeline` beat grid (`:650-693`) | `tickAtDuration` from `durationSeconds` | non-zero via D7, so the grid spans the chart |
| `ChartAssist` (whole section) | renders when any card is enabled | **renders `null`** (`ChartAssist.tsx:173-181`): `showAudioBackedCards`/`showSilence`/`showDrums`/`showLyrics` are all false without audio, and `staleDifficultyInstruments` is empty on a chart that has never generated difficulties. The section is simply absent, which is correct and needs no gating code |
| Difficulty generation | lives in the Chart Matrix row affordance (`sidebar/ChartMatrix.tsx`), not Chart Assist | renders and runs, unchanged, with no audio |
| `useSeparatedStems` | unconditional hook call (`TrackEditPage.tsx:688`) | still mounted; `probe` early-outs on `!packageAudio` (`useSeparatedStems.ts:126`), so it returns `[]` and costs nothing. **No code change** |
| `chartPackage.useChartPackageEditor` | `loadAudio` calls `chartPackageAudioBytes`, which throws on an empty list | host omits `loadAudio`; `getAudioSources` returns `[]` |
| `ExportDialog` / `lib/chart-export/assemble.ts` | receives `AudioSource[]` | verified safe: `audioSources = []` is the default (`assemble.ts:260-266`) and its only use is `for (const audio of audioSources)` (`:310`), a no-op on an empty list. The function throws only when given no `chartText`/`chartFile`/`chartDoc` (`:279`). Chart-only export works; §10.17 pins it |
| `StemsMixer` | `if (trackNames.length === 0) return null` | one track (click) plus the null-state row (§6) |
| `useLoopRegionSync` | sets loop on the manager | unchanged |
| `AddLyricsDialog` | reached from the Lyrics card | card absent |

Identity and length both persist through the `song.ini` `writeChartFolder`
emits and `withSongIniFields` overlays on load (D7). No `metadata.json` mirror,
no dependency on plan 0080.

Consequence worth stating for the first-run impression: on a brand-new blank
chart the sidebar is a click row, the stems null-state drop target, and the Chart
Matrix. Chart Assist is absent until there is audio or a stale difficulty set.

---

## 6. The stems null state, and attaching audio

### 6a. Null state

`StemsMixer` currently returns `null` when there are no track rows. It gets a
third state, chosen by a new `emptyState?: boolean` host prop (set when
`record.hasAudio` is false), which renders the existing drop target as the
section's body with the copy:

> Drop an audio file here to add it to this chart

The existing drop row's markup, `dragOver` handling, `pickStemFile` picker
(`id: 'chart-editor-add-stem'`) and `addStemFromFile` are reused, with the
`onAddStem` payload widened per D8. Note that the click row still renders above
it, so the section is never truly empty.

`TrackEditPage` starts passing `onAddStem`, which it does not today
(`TrackEditPage.tsx:823`).

`onAddStem`'s doc comment says the host must reject stems whose format does not
match its `PaddedAudioMeta`. On a blank project there is no `PaddedAudioMeta`
(`TrackEditPage.tsx:711` passes `null`), so the host's rule is: no meta means
nothing to conflict with, accept the file and let the attach establish the
project's audio format from it.

### 6b. Formats

Unchanged. The picker's `types` filter stays `.wav/.mp3/.ogg`. Widening it to
`.opus/.flac/.m4a` was not asked for and rests on `decodeAudioData`'s
browser-dependent codec support; adding them to the *filter* would only convert
"the user cannot select it" into "a toast after the decode fails". Drag-and-drop
is not filtered by the picker types anyway, so those formats are already
reachable for anyone whose browser decodes them, with the existing
`toast.error('Could not read that audio file')` as the failure mode.

### 6c. Several files at once, and which one is the full mix

Drag-and-drop today takes `e.dataTransfer.files[0]` and silently ignores the
rest (`StemsMixer.tsx:323`). Change: iterate all dropped files, adding them
sequentially through the existing `pendingStemNamesRef` uniquifier, which was
written for exactly this race. `pickStemFile` stays single-select (its comment
explains why).

`e.dataTransfer.files` order is not a meaningful ranking, so **which file becomes
the full mix on a project that has none is decided by size, not order**: the
largest audio file is the full mix, since stems are smaller partial mixes. That
heuristic already exists in `DrumTranscriptionClient.handleChartPackageLoaded`
(`:296-298`); per the no-duplication rule it is extracted to
`lib/chart-editor-core/pickPrimaryAudioFile.ts` and that callsite retargeted onto
it in its own commit, then reused here. Every remaining file is a stem.

One host rebuild per file is acceptable (it is the existing behavior for repeated
drops); batching the rebuild is a possible follow-up, not a requirement.

### 6d. Persistence, and what happens to chart timing

The dropped bytes (D8) are written into the project's `audio/` directory by
`lib/project-storage/attachAudio.ts`, `hasAudio` flips to true, `song_length` in
the chart doc and `durationSeconds` on the record are rewritten from the decoded
duration, and the click track is regenerated at the new length by
`usePaddedAudio`'s rebuild — which now actually fires, because `fullMixPcm` and
the duration are part of `BuildTarget` (§4e).

**Chart timing is not touched.** Notes are stored in ticks against the chart's
own tempo map; attaching audio does not move a tick. What changes is only which
wall-clock instant a tick lands on relative to the new audio, and the answer is
"tick 0 == audio sample 0", the same contract every existing project has. If the
audio has leading silence, the Add leading silence card (now available, because
`audioSampleRate` is defined) is the intended remedy, and it already pads both
playback and export on this host. Say plainly in the plan: **there is no
auto-alignment.** A chart authored against 120 BPM before the audio arrived will
not magically match the song.

Consequence worth stating: `AudioManager` folds every file whose name contains
`drums` into one `drums` track (`audioManager.ts:110-127`);
`StemsMixer.stemNameForOwnTrack` already rewrites such names, and
`packageHasDrumsAudio` in `hooks/projectAudio.ts` already exists for the related
separated-stem conflict. No new logic needed.

---

## 7. Interaction with plan 0080 (`song.ini` persistence)

The two plans are now nearly disjoint, because D7 removed this plan's need for
an ini writer:

- **0080 owns `song.ini` semantics**: which fields it carries, when the editor
  rewrites it, and the load-path merge. Everything under its D1, D2, D3.
- **0084 owns `metadata.json` and the facade**: the `origin`/`hasAudio` fields,
  `ProjectRecord`, `lib/project-storage/projects.ts`, and which layout a project
  has.

Points of contact, so neither invents the other's schema:

1. `createBlankProject` writes the `song.ini` that `writeChartFolder` already
   emits, through the existing `createProject(allFiles)` path. It invents no ini
   writer and needs none of 0080's helpers. If 0080's `writeIniFile` lands first,
   `createBlankProject` may switch to it as a cleanup; nothing depends on the
   order.
2. 0080's D5 ("`ProjectMetadata.name/artist/charter` is a display
   denormalization, refreshed on every save") is the rule 0084's landing list
   depends on, and 0084 §4c adds `artist`/`charter` to the drum-transcription
   record and fixes `EditorApp.handleMetadataChange` to write them. 0080 §5b
   calls for the same fields; whichever lands first adds them, the other's diff
   shrinks.
3. Rename from the landing page (§8) writes **both** the record and the chart's
   `[Song] Name`, precisely so 0080's D5 mirror does not silently undo it on the
   next autosave.

**There is no required ordering between the plans.** Either can land first.

---

## 8. The landing page

`components/project-list/ProjectList.tsx`, driven by `ProjectRecord[]`.

**Row**: song name (title); `artist · relative date` as the subtitle, or a
"Needs processing" marker when `ready` is false (D5); an origin badge for rows
whose origin is not the page's own (so `/chart-editor` shows "Drum
transcription" on those rows and nothing on its own); an `Open`/`Resume` button
plus an overflow menu with Rename and Delete. This is the existing
`TrackEditPage.tsx:371-403` row plus the badge, the readiness marker and the
rename entry.

**Thumbnail**: no. Album art is stored only in the `chart-package` layout, at the
project root under whatever name the package used; the `drum-transcription`
layout keeps package assets in `assets/`. Reading and decoding one image per row
on a list of unknown length is not worth it. Instrument chips
(`components/ChartInstruments.tsx`) would need the chart parsed and therefore a
denormalized field on the record; out of scope (§11).

**Rename**: a small dialog. On save it (a) writes `name`/`artist`/`charter` to
the record through the facade, and (b) loads the project's chart text, applies
the same fields via `applySongIniMetadata` (`lib/chart-editor-core`), and writes
it back, so the document and the record agree and the editor's own metadata save
is a no-op rather than a revert (§4c, §7.3). Rename is offered on every row
including drum-transcription ones, because §4c removes the name-composition that
would otherwise clobber it.

**Delete**: the existing `AlertDialog` from `TrackEditPage.tsx:420-440`, verbatim.

**Empty state**: `/chart-editor` with no projects shows the drop zone and the
"New chart" button and no Recent Projects card at all (today the card is hidden
by `projects.length > 0`, so this is already the behavior; keep it and add a one
line hint under the drop zone). `/drum-transcription` with no drum-transcription
projects shows its `SourcePicker` and no list, as today.

**New chart**: a button beside the drop zone on `/chart-editor` only. It opens a
tiny dialog for name and artist (both optional), calls `createBlankProject`, and
pushes `/chart-editor?project=<id>`.

---

## 9. Phases

Each phase is independently landable, type-checks with `pnpm typecheck`, and
leaves `pnpm test` green (modulo the accepted `lib/drum-fills/db` failure).

**Phase 1 — the facade and the record. No user-visible change.**
`lib/project-storage/types.ts`, `projects.ts`, the two adapters, the `origin` /
`hasAudio` / `artist` / `charter` fields, D2's read-time derivation, the
`stage` → `ready`/`pipelineStage` mapping. Both existing landing screens keep
using their own stores. Tests: §10.1-§10.4. Pure addition; lands on its own.

**Phase 2 — landing pages and routing.**
`ProjectList`; `/chart-editor` lists every record, mounts the host from
`record.layout` (D4) for ready projects and redirects non-ready ones to
`/drum-transcription?project=` (D3); `/drum-transcription` lists only its own,
keeps `checkProjectStage` and redirects only ready projects to `/chart-editor`;
rename; `EditorApp.handleMetadataChange` writing `name`/`artist`/`charter`
separately (§4c); the shared provider stack. `TrackEditPage`'s and
`DrumTranscriptionClient`'s duplicated list markup is deleted. Tests:
§10.5-§10.10.

**Phase 3 — the blank chart.**
`createBlankChartDocument` (with `lib/tempo-map/build-chart.ts` retargeted onto
it in its own commit, per the no-duplication rule); `createBlankProject` writing
`notes.chart` + `song.ini`; the `silentDurationSeconds` path and the widened
`BuildTarget` in `usePaddedAudio` / `buildPaddedAudioManager`; the `AudioManager`
duration guard; the `hasAudio: false` branch through `TrackEditEditor`'s load and
Chart Assist wiring; the click-volume decision from §5; the New chart button.
Tests: §10.11-§10.17.

**Phase 4 — attach audio from the stems section.**
`StemsMixer` null state and multi-file drop; the widened `onAddStem` payload
(D8); `pickPrimaryAudioFile` extracted and reused (§6c);
`lib/project-storage/attachAudio.ts`; `TrackEditPage`'s `onAddStem`;
`song_length` / `durationSeconds` / `hasAudio` rewrite; the Chart Assist cards
appearing once audio exists. Tests: §10.18-§10.21.

**Phase 4b (optional) — `EditorApp` adopts `attachAudio`.** Makes dropped stems
persist on `/drum-transcription` projects too. One handler swap; severable.

**Phase 5 (its own plan) — converge the layouts.**
Retarget the drum-transcription pipeline onto the canonical layout so there is
one `ProjectLayout` for new projects, and merge `EditorApp` into
`TrackEditEditor`. Everything the two hosts do differently (export sources,
decoded onsets, vocals stem, `.mid` charts, `gridSource`, `stage`) has to be
preserved. Do not start this until Phases 1-4 have been used in anger.

---

## 10. Test plan

Jest (`pnpm test`). Business logic first; the browser pass verifies, it does not
prove. Store tests reuse the existing fake-OPFS harnesses:
`lib/project-storage/__tests__/opfsProjectStore.test.ts` and
`lib/drum-transcription/storage/__tests__/fake-project-opfs.ts`.

Phase 1:

1. `listProjects()` returns projects from both layouts, sorted `updatedAt`
   descending, deduped by id with the primary namespace winning.
2. A `chart-package` project written with no `origin` reads back as
   `origin: 'chart-editor'`; a `drum-transcription` one as
   `'drum-transcription'`; a project with a written `origin` keeps it.
3. `hasAudio` absent reads back as `true` (existing projects must not become
   audio-less). A `drum-transcription` project at `stage: 'separating'` reads
   back `ready: false`, `pipelineStage: 'separating'`, `durationSeconds: null`;
   one at `'editing'` reads back `ready: true`.
4. `findProject`/`deleteProject`/`renameProject` resolve a project living in an
   adopted legacy namespace (`drum-edit`) and write in place.

Phase 2:

5. `ProjectList` filtered to `origin === 'drum-transcription'` renders only those
   rows; unfiltered renders all, with a badge on the foreign-origin rows and the
   "Needs processing" marker on `ready: false` rows.
6. `/chart-editor?project=<id>` mounts `EditorApp` for a **ready**
   `drum-transcription` record and `TrackEditEditor` for a `chart-package`
   record (RTL, mocked facade).
7. `/chart-editor?project=<id>` on a **non-ready** record mounts no editor and
   issues one `router.replace` to `/drum-transcription?project=<id>` — the
   regression that would otherwise strand every interrupted pipeline.
8. `/drum-transcription?project=<id>` on a ready record issues one
   `router.replace` to `/chart-editor?project=<id>`; on a non-ready record it
   issues **no** redirect and starts a `{kind: 'resume'}` run (pin
   `checkProjectStage`'s surviving behavior).
9. A completed drum-transcription run pushes `/chart-editor?project=<id>`.
10. Rename writes both the record and the chart's `[Song] Name` (read the chart
    text back and assert), and `EditorApp.handleMetadataChange` writes
    `{name, artist, charter}` without composing `"X by Y"` into `name`.

Phase 3:

11. `createBlankChartDocument` — one Expert Drums track, one tempo, one 4/4, the
    requested `song_length`, `format: 'chart'`; and `writeChartFolder` on it
    emits both `notes.chart` and a `song.ini` containing `song_length`.
12. `createBlankProject` + `readSongIni` + `withSongIniFields` round-trips
    `song_length` and name/artist/charter back out of OPFS (the D7 claim, end to
    end, against the fake-OPFS harness).
13. `lib/tempo-map/build-chart.ts` still produces byte-identical output after
    being retargeted onto the shared builder (pin the existing behavior first).
14. `buildPaddedAudioManager` with a null full mix produces a manager whose
    `trackNames` is `[CLICK_TRACK_NAME]` and whose duration equals the requested
    silent duration.
15. `usePaddedAudio` rebuild gating: a change to `fullMixPcm` alone (null →
    buffer, same `stems`, same `padSamples`) triggers a rebuild; a change to
    `silentDurationSeconds` alone triggers a rebuild; an unchanged target does
    not.
16. `AudioManager` with zero audio files reports `duration === 0`, not
    `-Infinity`.
17. RTL: an editor mounted on a `hasAudio: false` record renders the transport,
    the piano roll, the highway and the Chart Matrix without throwing; **Chart
    Assist renders nothing at all** (§5); `assembleChartFiles` with
    `audioSources: []` produces a chart-only package.

Phase 4:

18. `StemsMixer` with `emptyState` renders the drop copy; a drop of two files
    calls `onAddStem` twice with distinct names (the `pendingStemNamesRef`
    uniquifier) and each payload carries the source file's bytes (D8).
19. `pickPrimaryAudioFile` picks the largest file, and the existing
    `handleChartPackageLoaded` behavior is unchanged after being retargeted onto
    it.
20. Attaching files to a `hasAudio: false` project: the largest becomes the full
    mix and the rest become stems; `hasAudio` flips; `song_length` and
    `durationSeconds` are rewritten from the decoded duration; every note's tick
    is unchanged; the bytes land in `audio/`.
21. After attaching audio, the Chart Assist audio-backed cards render.

Browser (chrome-devtools MCP, per CLAUDE.md), after Phases 2, 3 and 4:
`/chart-editor` lists a drum-transcription project and opens it; a project left
mid-pipeline shows "Needs processing" and resuming from `/chart-editor` lands on
the processing view rather than a broken editor; New chart lands in the editor
with a working transport and a clean console; the stems null state takes a
dropped mp3 and the mixer grows a `song` row that actually plays;
`/drum-transcription` shows only its own projects. Check
`list_console_messages` and `list_network_requests` each time.

---

## 11. Out of scope

- Merging `EditorApp` and `TrackEditEditor` (Phase 5, its own plan).
- Moving any project's bytes between namespaces (D1).
- Making `/tempo` and `/add-lyrics` project-backed. Both are download-terminated
  in-memory flows (`TempoClient.tsx` 948 lines, `AddLyricsClient.tsx` 957) and
  converting them is a redesign of each; the owner's ask covers them only by
  implication. A follow-up plan, not a severable phase of this one. Consequently
  `ProjectOrigin` has two members, not four; adding a member later is one line.
- `song.ini` field coverage, the load-path merge beyond what exists today, and
  export ini fidelity: plan 0080.
- Making `song_length` editable in the song-details dialog.
- Album art thumbnails and instrument chips on the landing list, and album-art
  export from `/chart-editor` (0080 §11 records that as a separate bug).
- Widening the stem picker's format filter (§6b).
- Any auto-alignment of an existing chart to newly attached audio (§6d).
- Project export/import to a file (a "backup my OPFS" feature), project folders
  or tags, and multi-select on the landing list.
- Server-side or cross-device project storage. Everything stays in OPFS.
- `ProjectMetadata.sngMetadata` and `loadFilesForExport`/`original-files.json`,
  all dead on read today.

---

## 12. Where this plan is uncertain

Stated rather than papered over:

1. **The highway with no waveform PCM.** `audioData` is typed optional all the
   way down, but no route has ever mounted the highway without it. Phase 3 must
   verify `HighwayLane.tsx` and `lib/preview/highway/stage.ts` visually, not just
   by types. If the surface breaks, the fallback is to keep the highway's
   waveform mode unavailable on a no-audio project rather than to fix it here.
2. **The click volume default** (§5). Playing silence with no feedback is a bad
   first impression of the New chart feature, but changing `defaultVolumeFor`'s
   contract touches every editor route's mixer. The proposal (an options
   argument, defaulted to today's behavior) is the conservative version; the
   owner may prefer the click simply be audible by default everywhere.
3. **The default blank-chart length** (5 minutes). It only affects how far the
   beat grid runs before audio arrives, and D7 makes it editable in one place.
4. **Whether the D3 pair of complementary redirects is the shape to keep.** It is
   correct and loop-free, but it means `/chart-editor` can bounce a user to
   another route. The alternative — hoisting `ConnectedProcessingView` into
   `/chart-editor` so one route handles both states — is more work now and is
   what Phase 5 should end up doing anyway.

---

## 13. Objections considered

A contrarian review of the first draft. Every factual claim below was re-verified
against the source before being accepted or rejected.

**1. `ProjectStage` dropped; the blanket `/drum-transcription?project=` redirect
deletes the pipeline-resume path. (Accepted, critical.)** Verified:
`storage/opfs.ts:144` defines `ProjectStage`, `createProject` (`:210`) writes
`stage: 'uploaded'` with `durationSeconds: null` before any audio exists, and
`DrumTranscriptionClient.checkProjectStage` (`:198-237`) plus
`handleSelectProject` (`:344`) are the only `{kind: 'resume'}` callers. A blanket
redirect would strand every interrupted separation. Fixed: `ProjectRecord` gains
`ready` + `pipelineStage` and `durationSeconds` is nullable (§D1, §4a); D3's
redirect is conditional and paired with a complementary redirect out of
`/chart-editor`; §1c documents the resume path; §D5/§8 mark non-ready rows;
§10.7-§10.8 pin both directions.

**2. §4e's "rebuild gating is unchanged" is false; `BuildTarget` omits
`fullMixPcm` and the duration. (Accepted, critical.)** Verified at
`usePaddedAudio.ts:60-64` and `:265-277`. A blank project taking its first drop
changes only `fullMixPcm`, so the guard would return and nothing would play.
Fixed: §4e now widens `BuildTarget` explicitly, calls it a real behavioral
change, and adds §10.15. The same section now states all three parts of the
entry guard and how `audioMeta: null` is handled.

**3. §6d's persistence contradicts the `onAddStem` PCM-only contract.
(Accepted.)** Verified: `StemsMixer.addStemFromFile:221-241` hands over
interleaved PCM only, and `EditorApp.handleAddStem:461-473` is session-only
state. Fixed: D8 widens the payload to carry the source bytes, and puts the
write in one shared `attachAudio` helper that `TrackEditEditor` adopts now and
`EditorApp` adopts in Phase 4b, so there is one writer rather than two. The
`PaddedAudioMeta`-null case is answered in §6a.

**4. D7 contradicted §5; `writeChartFolder` already emits a `song.ini`.
(Accepted, and it deleted work.)** Verified by running the round trip: it returns
`['notes.chart', 'song.ini']` and the ini carries `song_length`. Verified that
`createProject` writes root files from `allFiles` (`:246-251`), `readSongIni`
(`:387`) reads it, and `withSongIniFields` (`songIniMetadata.ts:58-68`) merges it
on load (`TrackEditPage.tsx:530-536`). Fixed: D7 is rewritten around that;
the `metadata.json` duration mirror is gone; `ProjectRecord.durationSeconds` is
demoted to an explicit display denormalization; §7 drops the ordering dependency
on plan 0080 entirely; the rejected mirror is recorded as Alternative G.

**5. Chart Assist renders `null` on a blank project. (Accepted.)** Verified at
`ChartAssist.tsx:156-181`: `staleDifficultyInstruments` needs an
already-generated, since-stale difficulty set, which a new chart cannot have, and
the four `show*` flags are all false. Fixed: §5's table now says the whole
section is absent, moves difficulty generation to its real home (the Chart
Matrix), §10.17 asserts absence instead of presence, and §5 closes by describing
what a new chart's sidebar actually looks like.

**6. The facade is not the only write path, so D2's opportunistic backfill never
fires. (Accepted.)** Verified: all five live `updateProject` callsites plus
`pipeline/runner.ts` bypass the facade. Fixed: D1 now states plainly that the
facade owns lifecycle and reads, not per-field domain writes, and why; D2 drops
the backfill claim and justifies storing `origin` on Phase 5 grounds alone.

**7. §12's `assemble.ts` uncertainty is answerable by reading it. (Accepted.)**
Verified: `audioSources = []` default at `:260-266`, single `for` loop at `:310`,
throw only on a missing chart input at `:279`. Fixed: the uncertainty is deleted,
§5's table states the verified behavior, and §10.17 keeps a cheap assertion.

**8. `EditorApp`'s name composition undoes §8's rename on every save.
(Accepted.)** Verified at `EditorApp.tsx:513-521`. Fixed: the three-line handler
change moves into this plan's Phase 2 (§4c), since §4c is already adding the
`artist`/`charter` fields it needs. §8 no longer scopes rename away from
drum-transcription rows, and §10.10 pins it.

**9. `useSeparatedStems` cannot be "not mounted". (Accepted on the wording;
rejected on the work.)** Verified: the hook call at `TrackEditPage.tsx:688` is
unconditional, so the plan's phrasing was wrong. But `probe` already early-outs
on `if (!pkg || !loadAssistAudio) return;` (`useSeparatedStems.ts:126`), so with
`packageAudio: null` it returns `[]` and costs nothing. §5's row now says exactly
that, and no code change is budgeted.

**10. Cut unasked-for scope. (Mostly accepted.)** §6b's widened picker formats:
cut, moved to out of scope, with the reasoning kept. Phase 2c (`/tempo` +
`/add-lyrics` projects): struck from the phase list and moved to §11 as a
follow-up plan, which also shrinks `ProjectOrigin` to two members. Instrument
chips: struck to §11. Multi-file drop (§6c) is **kept**, because the objection's
own evidence supplies the missing piece: `DrumTranscriptionClient:296-298`
already ranks by size, so §6c now extracts `pickPrimaryAudioFile`, retargets that
callsite onto it, and uses it to resolve the "which file is the full mix"
ambiguity instead of relying on `dataTransfer.files` order.

**11. `original-files.json` is dead code and should not be cited. (Accepted.)**
Verified: `loadFilesForExport` has no caller outside `opfsProjectStore.ts`. Fixed:
§1a's table row is reworded to describe root files generally, with a note that
the manifest has no live reader; §11 lists it alongside `sngMetadata` as dead on
read. `createBlankProject` does not care either way, since `createProject` writes
the manifest itself.
