# 0080 — Persist a real `song.ini` in stored chart projects

Status: implemented as part of plan 0084 (its D7b). Owner decision,
2026-08-05: 0084 owns the storage-schema change, so this plan's decisions D1
through D5 shipped as a phase of 0084 rather than as their own round. This
file stays as the design record and the source of the merge semantics; do not
implement it separately.

What shipped, and where it differs from this file:

- D1/D3 — one `song.ini` per project, rewritten on every save by both hosts,
  from the same `writeChartFolder` call the chart file comes from
  (`chartDocToFolderFiles`, `lib/chart-edit/folder-files.ts`). Ini first,
  then the chart, per §7.
- D2 — the merge lives in `withSongIniFields`
  (`lib/chart-editor-core/songIniMetadata.ts`), which both project load paths
  already called, rather than in a new `readChartProject`. It strips
  scan-chart's defaults (`defaultIniMetadata`, derived at runtime as §5c
  specifies; `stripDefaultIniMetadata`) and then lets every field the chart
  file defines win. `readChart`'s ini-wins semantics are untouched.
- D4 — `TrackEditPage` seeds the dialog's identity from the document, falling
  back to the project record.
- D5 — both hosts mirror the document's identity into the project record on
  every save (`documentIdentityFields`), and `EditorApp` had already stopped
  composing `"Song by Artist"` into `name`.

Deliberately not implemented here: the ini's `IniChartModifiers` are still
not fed back into the chart parse on load (§6's five-lane behavior change),
because `withSongIniFields` takes metadata only and re-deriving notes from a
stale ini on a document the caller already parsed is a bigger change than the
metadata loss this plan exists to fix. The pipeline runner and
`regenerateProject` (§5b) do not write an ini of their own; the first
autosave writes one, and until then the project loads from its chart exactly
as it did before. Phase 4 (export fidelity) is untouched and remains
severable.

The trigger for the decision: 0084's work introduced `writeSongIni` in
`lib/project-storage/`, called only at project creation, with `readChartText`
not merging the ini back on load. That is the first third of D1/D2 built
incidentally. A `song.ini` that is written but never read back is worse than
neither, because the code reads as though persistence works while
`diff_drums`/`diff_drums_real` still vanish on reload.

Revised after adversarial review — see §12.
Owner ask: "We need to be persisting and storing a song.ini in our chart
information, not just `[Song]` in .chart. If this needs to change our data
model and caching, come up with a plan and review it with a contrarian."

---

## 1. The problem, with evidence

The editor authors `song.ini` fields — album, genre, year, and per-instrument
`diff_*` intensities — through `SongMetadataDialog`, backed by
`lib/chart-editor-core/songIniMetadata.ts` and `lib/chart-difficulty/`. The
dialog's save lands on the live `ChartDocument` via `applySongIniMetadata` →
`SET_CHART_METADATA` (`lib/chart-editor-core/reducer.ts:265`).

Neither host persists it:

- `components/chart-editor/TrackEditPage.tsx:480` (autosave) writes
  `chartDocToChartText(state.chartDoc)`, which calls `writeChartFolder` and
  then **keeps only `notes.chart`** (`components/chart-editor/chartPackage.ts:138-146`).
  The `song.ini` produced by the same call is dropped.
- `app/drum-transcription/components/EditorApp.tsx:181-195` calls
  `writeChartFolder(state.chartDoc)` and `.find()`s only the chart file. Same
  drop.
- Both load paths parse the chart file **alone**: `TrackEditPage.tsx:524`,
  `EditorApp.tsx:308`.

What survives a reload today (verified against
`node_modules/@eliwhite/scan-chart/dist/index.js`):

| Field                                                                                                                                             | `.chart` `[Song]` writer (`serializeSongSection`, :817) | `.chart` parser (`parseNotesFromChart`, :3313) | Survives?                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------- | ---------------------------------- |
| `name`/`artist`/`charter`/`album`/`genre`                                                                                                         | written                                                 | read                                           | yes                                |
| `year`                                                                                                                                            | written as `Year = ", 2004"`                            | read with `.slice(2)`                          | yes                                |
| `chart_offset`, `preview_start_time`                                                                                                              | written                                                 | read                                           | yes                                |
| `diff_guitar`                                                                                                                                     | written as `Difficulty = N`                             | `Number(...) \|\| undefined`                   | yes **except `0`** (falsy → unset) |
| `diff_drums`, `diff_drums_real`, and every other `diff_*`                                                                                         | **not written**                                         | —                                              | **no**                             |
| `delay`, `pro_drums`, `five_lane_drums`, `song_length`, `icon`, `album_track`, `playlist_track`, `modchart`, `video_start_time`, `extraIniFields` | **not written**                                         | —                                              | **no**                             |

So the one value the difficulty calculator exists to recommend (`diff_drums`,
`diff_drums_real`) is session-lived, and `diff_guitar = 0` is silently lost.
For `.mid` projects (drum-transcription chart-flow) the loss is total:
`writeMidiFile` carries no metadata, so a reloaded `.mid` project has empty
`parsedChart.metadata` — no name, artist, charter, album, or difficulty.

Two further facts that shape the design:

- **`/chart-editor` already stores the imported `song.ini` on disk**, at the
  project root, listed in `original-files.json`
  (`lib/project-storage/opfsProjectStore.ts:228-251`); for `.sng` imports the
  ini is synthesized by `SngStream({generateSongIni:true})`
  (`components/chart-picker/chart-file-readers.ts:87`). Nothing reads it.
- **The stored `notes.chart` is not the imported file.**
  `TrackEditPage.tsx:249-252` sets `format = 'chart'` and stores
  `chartDocToChartText(chartDoc)` — a re-serialization of the _ini-merged_
  doc. So at import time the stored chart and the stored ini agree by
  construction. This is what makes migration cheap (§6).

---

## 2. What scan-chart gives us — and the trap in it

Free:

- `writeChartFolder(doc)` already emits `song.ini` from
  `doc.parsedChart.metadata` on every call (`index.js:2335-2338`), via
  `writeIniFile`, which **omits any field equal to scan-chart's default**
  (`index.js:514-530`) and appends `extraIniFields` verbatim.
- `parseChartAndIni(files)` reads chart + ini, resolves the parse-affecting
  ini modifiers, and preserves unknown ini keys as `metadata.extraIniFields`.

The trap, and the single most important fact in this plan:

> **`parseChartAndIni`'s ini merge is dense-over-sparse, not
> field-by-field.** `scanIni` → `extractSongMetadata` (`index.js:387-425`)
> builds a **fully populated** metadata object: every key is assigned, and
> `getIniString`/`getIniInteger` return `defaultMetadata[key]`
> (`index.js:467-476`) — `"Unknown Name"`, `"Unknown Artist"`,
> `"Unknown Album"`, `"Unknown Charter"`, `-1` — when the key is absent. The
> merge is `{...chartMetadata, ...iniMetadata}` (`index.js:5364`). The
> chart-file parse, by contrast, is sparse (`name: metadata["Name"] || void 0`,
> `index.js:3313`).

Consequences we must design around:

1. Feeding _any_ ini to `parseChartAndIni` replaces the chart's real
   `[Song]` values with `"Unknown *"` wherever the ini omits them — and
   `writeIniFile` omits precisely the fields that equal the defaults. A naive
   "write the ini, read it back with ini-wins" round trip therefore **loses
   identity on the second load**.
2. Every host that guards on truthiness — `EditorApp.tsx:730-732`
   (`chart.metadata.name || projectMeta?.name || 'Untitled'`) — silently flips
   to `"Unknown Name" by Unknown Artist` the moment an ini exists, because
   `"Unknown Name"` is truthy where `undefined` was not.
3. scan-chart itself treats default-valued == unset: `extractSongMetadata`
   raises a `missingValue` metadata issue exactly when a required field equals
   its default (`index.js:440-444`). So "default means unset" is scan-chart's
   own semantic, not our invention.

This is why the design below does **not** simply hand the ini to
`parseChartAndIni` and take the result.

---

## 3. Core decisions

**D1 — The ini is a real file on disk, one per project, next to the chart.**
Both hosts keep the `song.ini` entry `writeChartFolder` already returns and
write it beside the chart file, at project creation and on every autosave.
Not a JSON field (see §4-A, and §12/O9 for the contrarian's case against this).

**D2 — On project reload, the merge is ours, not `parseChartAndIni`'s
ini-wins.** A new `readChartProject(files, override?)` in `lib/chart-edit/`,
used _only_ by the two editor load paths:

1. Run `parseChartAndIni(files)` as today — this resolves `iniChartModifiers`
   (so the chart parses the way it did at import) and collects
   `extraIniFields`.
2. **Strip defaults**: drop every metadata key whose value equals scan-chart's
   default. Default == unset, per §2.3. This restores the sparse shape every
   host already expects and is what keeps `EditorApp.tsx:730` working.
3. **Chart file wins on the fields it can express** (`name`, `artist`,
   `album`, `genre`, `year`, `charter`, `diff_guitar`, `chart_offset`,
   `preview_start_time`): overlay the chart-only parse's defined values on
   top. Both files were written from one doc in one save, so this is not a
   conflict policy so much as a lossiness policy — where the two disagree it
   is because one format could not represent the value, and the `.chart`
   `[Song]` section is the one that can represent an _empty_ string.

   Rationale for not reusing ini-wins: ini-wins is correct for **scanning a
   folder somebody else authored** — the game reads the ini, so the ini is the
   authority — and `readChart` keeps that behavior unchanged for every other
   route (`/preview`, `/chart-review`, `/sheet-music`, `/add-lyrics`,
   `/tempo`, the chart pickers). It is wrong for **reloading a project we
   ourselves wrote**, where the ini is a lossy re-encoding of the same doc.

   `readChart`'s signature and semantics do not change. `readChartForEditing`
   gains a project-mode sibling; the four-lane→pro upgrade is shared.

**D3 — One ini file, `song.ini`, overwritten by every save.** No
`.edited` variant. The chart's original/edited split exists because the
original chart is a large artifact worth keeping; the ini is a few hundred
bytes that we regenerate from the doc on every save and on every export, and
under D2 a stale ini can no longer clobber anything the chart file carries.
Dropping the split removes the migration discriminator, the second file, and
an entire class of "which of these two inis is authoritative" bugs.

**D4 — `TrackEditPage` seeds the dialog's identity from the document, falling
back to the project record.** `TrackEditPage.tsx:803-805` currently passes
`projectMeta.name/artist/charter` unconditionally into `ChartEditor`, which
feeds them into `readSongIniMetadata` (`ChartEditor.tsx:281-285`). Once the ini
persists a real charter, opening the dialog would show the project record's
value and _write it back over the ini_ on save. `EditorApp.tsx:730-732`
already prefers the doc and needs no change (the earlier draft of this plan
had this exactly backwards — see §12/O3).

**D5 — `ProjectMetadata.name/artist/charter` is a display denormalization,
refreshed on every save.** It backs the Recent Projects list
(`opfsProjectStore.ts:283-289`) and the drum-transcription project name. It is
never read as metadata truth after D4. Both hosts' `saveFn` mirror the doc's
identity into it (`/chart-editor` already does this on dialog save,
`TrackEditPage.tsx:750-758`; `EditorApp.tsx:513-521` writes only a composed
`name` and never `artist` — it should store `artist`/`charter` too).

---

## 4. Alternatives considered

**A. Store `parsedChart.metadata` as JSON in `metadata.json`**, alongside
`audioAnchor`/`assistProvenance`. The contrarian's preferred option (§12/O9).
It is genuinely _more faithful_: it round-trips exactly, with no
default-omission, no `getIniString` treating `"0"`/`"-1"`/`""` as absent
(`index.js:467`), no `icon` lowercasing or clearing (`index.js:427-430`), and
no `Year = ", "` prefix dance.

Rejected, with the trade named honestly:

- Every one of those fidelity wins is **undone at export**, because
  `writeChartFolder` → `writeIniFile` is the only way a `song.ini` ever
  reaches the user. Option A would let the editor hold state that cannot
  survive the artifact it ships; D1+D2 makes the stored form the _same_ form
  as the shipped form, so what you see on reload is what Clone Hero will see.
- The owner asked for a stored `song.ini`, and an inspectable ini in the
  project directory is also what makes an OPFS dump debuggable.
- The fidelity gap is small and enumerable (§8 "known lossy fields"), and D2's
  chart-file-first rule closes the empty-string and `"0"` cases for
  `.chart`-format projects, which is every `/chart-editor` project.

If the lossy fields ever become user-editable, revisit A.

**B. Store only `diff_*` in `ProjectMetadata`.** Fixes the reported symptom and
nothing else — `delay`, `icon`, `extraIniFields`, and the `.mid` total loss all
stay broken — for the same implementation cost as A.

**C. Keep both an original and an edited ini.** Superseded by D2/D3: with the
chart winning on the fields it carries, the discriminator buys nothing.

**D. Put `diff_*` in `.chart`'s `[Song]`.** They round-trip only as
`extraChartSongFields` (`index.js:3305`), which Clone Hero does not read.
Non-starter.

---

## 5. Data model change, per store

### 5a. `/chart-editor` — `lib/project-storage/opfsProjectStore.ts`

`song.ini` already exists at the project root (imported, unread). It becomes a
live, editor-owned file:

- `createProject` writes it from `writeChartFolder(chartDoc)` instead of from
  the raw import, and stops listing it in `original-files.json` (it is
  regenerated, not an original — and `assembleChartFiles` rejects a
  passthrough named `song.ini` anyway, `lib/chart-export/assemble.ts:71`).
- New: `writeIniFile(projectId, data: Uint8Array)` and
  `readIniFile(projectId): Promise<File | null>`. Both resolve through
  `getProjectDir`, so **legacy namespaces work unchanged** — a project living
  in an adopted namespace has its ini read and written in place, exactly like
  its chart (`opfsProjectStore.ts:110-171`).

### 5b. `/drum-transcription` — `lib/drum-transcription/storage/opfs.ts`

No ini is stored today; chart-flow ingest explicitly filters `song.ini` out of
`extraAssets` (`app/drum-transcription/DrumTranscriptionClient.tsx:305-315`).
Add `song.ini` at the project root, written by `EditorApp.saveFn` and by the
pipeline runner where it first persists a chart
(`lib/drum-transcription/pipeline/runner.ts:355-360`, beside
`writeProjectAssets`). Reuse `writeProjectBinary` / `readProjectBinary` /
`projectFileExists` — no new IO primitives.

`regenerateProject` rebuilds the chart from audio; it must rewrite the ini from
the regenerated doc in the same step, or the next load would merge an ini
describing the old chart.

### 5c. Shared seam

Add to `components/chart-editor/chartPackage.ts`:

```ts
chartDocToFolderFiles(doc): {chart: FileEntry; ini: FileEntry}
```

`chartDocToChartText` becomes a one-line consumer of it, and `EditorApp`'s
duplicated `writeChartFolder(...).find(...)` block uses it too.

Add to `lib/chart-edit/`:

- `defaultIniMetadata()` — the default table, **derived at runtime**, not
  hardcoded: parse a synthetic minimal folder (`[Song]{Resolution=192}` plus
  `[song]` with no keys) through `parseChartAndIni` and keep the result,
  memoized. scan-chart does not export `defaultMetadata`, and hardcoding ~34
  values would silently drift on the next fork bump. (Follow-up: export
  `defaultMetadata` from our scan-chart fork and delete this; the fork is ours,
  see plan 0039.)
- `stripDefaultIniMetadata(metadata)` — drops keys equal to the default table.
- `readChartProject(files, override?)` — D2's three steps.

`ProjectMetadata.sngMetadata` (both stores) is written at import and **never
read** (verified: only writes and type declarations). It is a latent third copy
of ini data. Left alone (§11) and explicitly not made a metadata source.

---

## 6. Migration

There is exactly one rule, because D2/D3 removed the need for a discriminator:

> **If the project directory has a `song.ini`, load it with the chart through
> `readChartProject`. If it does not, behave exactly as today.**

Per store:

- `/chart-editor`, imported and never edited → the stale-by-nothing original
  ini is merged in. `diff_*`, `delay`, `icon`, `extraIniFields` that have been
  dropped at every load since the project was created come back. Strict
  improvement.
- `/chart-editor`, edited before this plan → the original ini is merged in, but
  **only for fields the chart file cannot carry**. Identity, album, genre,
  year and `diff_guitar` come from the user's edited `notes.edited.chart`.
  The ini's `diff_drums` etc. are the import-time values — which is exactly
  what the doc had at import, since any later dialog edit to them was already
  lost by the bug this plan fixes. No new loss is possible.
- `/drum-transcription`, any pre-existing project → no ini on disk, so today's
  behavior, until the first save writes one.

Nothing is deleted, nothing is rewritten in bulk, no startup migration pass. A
project self-heals on its next autosave.

**One intentional behavior change, called out because §7 of the earlier draft
wrongly claimed there was none.** Merging the ini also resolves
`iniChartModifiers` (`index.js:5362`), which affect the _chart parse_:
`five_lane_drums`, `pro_drums`, `hopo_frequency`, `sustain_cutoff_threshold`,
`chord_snap_threshold`. A legacy `/chart-editor` project whose ini says
`five_lane_drums = True` is parsed as four-lane today (ini never fed) and will
be parsed as five-lane after this lands. That is the _correct_ reading — it is
how the same folder parsed at import, and how Clone Hero reads it — but it is a
content-level change to existing projects and needs the regression test in
§10.5/§10.6. Host overrides continue to layer on top exactly as today
(`readChartForEditing` forces pro-drums only when `drumType === fourLane`;
`EditorApp` forces `pro_drums` unconditionally on its drums-only editor).

---

## 7. Caching and the dirty/autosave question

**Does any cache key include chart bytes?** No. The only fingerprint is the
stem cache's SHA-256 over _audio bytes_ + separator id
(`lib/audio-pipeline/stem-cache.ts:22`), persisted as
`ProjectMetadata.stemFingerprint`. Chart or ini edits cannot invalidate it.
The editor's staleness stamps (`lib/chart-editor-core/content-stamps.ts`) hash
note/star-power/lane events and the sync track only — the word `metadata` does
not appear in that file. scan-chart's `chartHash` is computed only inside
`scanChart`, which neither host calls. **Nothing needs invalidating; no cache
key changes.**

**Should an ini edit dirty the chart autosave?** It already does:
`SET_CHART_METADATA` returns `dirty: true` while deliberately leaving content
stamps and both undo stacks alone (`reducer.ts:265-269`), and `useAutoSave`
fires on `state.dirty`. Keep it. The distinction the editor draws is _chart
content_ (stamps, undo) vs _document metadata_ (neither) — not "worth
persisting" vs "not". A separate save channel would put two writers on one
project directory for no benefit; the marginal cost here is one extra
few-hundred-byte OPFS write.

**Write order within a save: ini first, then the chart file.** A torn save then
leaves a newer ini with an older chart; under D2 the ini contributes only
fields the chart cannot carry, so the visible result is one-autosave-stale
chart content — the same exposure the chart write alone has today. The reverse
order would present stale metadata over fresh content, which reads to the user
as "my edit was lost".

---

## 8. Round trip: where the ini is read and written at each hop

| Hop                                    | Today                                                                                                      | After                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Import `.sng`                          | `generateSongIni` synthesizes `song.ini` into `loaded.files`                                               | unchanged                                                                     |
| Import `.zip`/folder                   | ini in `loaded.files` if present                                                                           | unchanged                                                                     |
| Parse at import                        | `readChart(files)` — ini-wins merge                                                                        | unchanged (other routes rely on this)                                         |
| `/chart-editor` `createProject`        | imported ini stored as an original file                                                                    | ini **regenerated** from the doc; dropped from `original-files.json`          |
| drum-transcription ingest / regenerate | ini dropped entirely                                                                                       | ini written from the doc                                                      |
| Autosave (both hosts)                  | chart file only                                                                                            | **ini first, then chart file**                                                |
| Reload (both hosts)                    | chart alone → `diff_*` gone, `.mid` metadata empty                                                         | `readChartProject([chart, ini])` → full metadata                              |
| Dialog edit                            | `applySongIniMetadata` → `SET_CHART_METADATA`                                                              | unchanged; identity seed fixed on `/chart-editor` (D4)                        |
| Export                                 | `chartText` → `assembleChartFiles` re-parses the chart **alone**, stamps 6 catalog fields + `difficulties` | Phase 4: pass the live `chartDoc` so ini-only fields reach `writeChartFolder` |
| `.sng` export                          | `lib/chart-export/sng.ts:233` lifts `song.ini` into the SNG header                                         | unchanged                                                                     |

**Fields that now survive the loop:** the 6 catalog fields, all 13 `diff_*`
(including `diff_guitar: 0`), `delay`, `pro_drums`, `five_lane_drums`,
`song_length`, `loading_phrase`, `album_track`, `playlist_track`, `modchart`,
`preview_start_time`, `video_start_time`, `multiplier_note`, and arbitrary
`extraIniFields`.

**Known lossy fields, documented rather than fixed** (all are scan-chart ini
semantics, not new):

- `icon` is lowercased on parse, and cleared if it equals the charter
  (`index.js:427-430`). An `icon` matching the charter is destroyed on the
  first save either way — including today, at import.
- A field set to `"0"` or `"-1"` reads back as unset (`index.js:467`).
- Clearing a field to `""`: on `.chart`-format projects D2's chart-first rule
  keeps it cleared; on `.mid` projects it reads back unset (indistinguishable).
- `chart_offset` and `extraChartSongFields` have no ini representation
  (`writeIniFile` iterates `Object.keys(defaultMetadata)`, which excludes
  `chart_offset`), so on **`.mid`** projects they remain unrecoverable. `.mid`
  metadata recovery is otherwise complete.

---

## 9. Implementation phases

**Phase 1 — shared primitives, no behavior change.**
`chartDocToFolderFiles`; `defaultIniMetadata()`; `stripDefaultIniMetadata`;
`readChartProject`. Unit tests §10.1-§10.5. `EditorApp.saveFn` switched to the
shared seam.

**Phase 2 — `/chart-editor`.** Store `writeIniFile`/`readIniFile`;
`createProject` regenerates the ini; `saveFn` writes it (ini first);
load path uses `readChartProject`; D4 identity seeding; D5 mirror.
Update the existing store mocks in
`components/chart-editor/__tests__/track-edit-page-audio.test.tsx` and
`track-edit-page-visibility-seeding.test.tsx`, which drive the real load path
against a fake store and will otherwise break on the new `readIniFile` call.

**Phase 3 — `/drum-transcription`.** Same two edits, plus the pipeline runner
and `regenerateProject` writing an ini, plus D5's `artist`/`charter` on the
project record.

**Phase 4 — export fidelity (severable).** `ChartEditor` passes
`state.chartDoc` to `ExportDialog`, which forwards it as
`assembleChartFiles({chartDoc})` (the branch already exists,
`assemble.ts:255-286`), keeping `chartText`/`chartFile` as the fallback.
Without it, `extraIniFields`, `icon` and `delay` are persisted faithfully and
then dropped at the last hop. This is a pre-existing bug in a different
subsystem and **must land after Phases 1-3**, never before: it is the only
path that writes a file the user ships, and it should not carry
freshly-merged metadata until the merge is proven. If it grows, split it into
its own plan; nothing else here depends on it.

---

## 10. Test plan

Jest (`pnpm test`). Business logic first; the browser pass verifies, it does
not prove.

Unit:

1. `defaultIniMetadata()` — derived table is non-empty and contains the
   catalog keys; asserted by construction, not by hardcoded strings, so a fork
   bump cannot make it stale silently.
2. `stripDefaultIniMetadata` — a metadata object straight out of
   `parseChartAndIni` on a folder with an empty `[song]` reduces to `{}`; a
   real value equal to a default (e.g. a song genuinely titled
   `Unknown Name`) is also dropped — documented as acceptable, with a comment
   pointing at scan-chart's own `missingValue` semantics.
3. `chartDocToFolderFiles` — returns exactly the chart file matching
   `doc.parsedChart.format` plus `song.ini`; the chart bytes are identical to
   what `chartDocToChartText` produced before.
4. **Full round trip:** doc with every `diff_*` set (including
   `diff_guitar: 0`), `delay`, `loading_phrase`, and an `extraIniFields` key →
   `chartDocToFolderFiles` → `readChartProject([chart, ini])` → metadata equal
   to the original. Pins the `diff_guitar: 0` and `year` cases from §1.
5. **The O1 guard (regression test for the design flaw this plan was revised
   to fix):** doc with `artist: 'Real Artist'`, `album: ''`, and no `icon` →
   write → `readChartProject` → artist is `'Real Artist'` (**not**
   `'Unknown Artist'`), album is empty/unset, `icon` is `undefined`. The same
   fixture through plain `readChart` returns `'Unknown Artist'` — asserted, so
   the reason `readChartProject` exists is encoded in a test.
6. `iniChartModifiers`: ini with `five_lane_drums = True` → `readChartProject`
   parses five-lane; ini with `pro_drums = False` + `{pro_drums: true}`
   override → cymbals preserved (the drum-transcription path).

Store-level (both stores, fake OPFS as the existing store tests do):

7. Save → reload preserves `diff_drums`/`diff_drums_real`, both stores.
8. Migration, `/chart-editor` legacy **edited** project: original ini says
   `artist = Old` + `diff_drums = 4`; `notes.edited.chart` says
   `Artist = New` → loaded doc reads `New` **and** `diff_drums = 4`. This is
   the case the first draft of this plan got backwards.
9. Migration, legacy **unedited** project: ini's `diff_drums` recovered.
10. Project with no ini at all loads exactly as today (drum-transcription
    legacy path).
11. `.mid` drum-transcription project: save → reload preserves
    name/artist/charter/album, all lost today.
12. Torn save (ini newer than chart): load succeeds; metadata from the ini.
13. Legacy-namespace project (`opfsProjectStore` `legacyNamespaces`): ini is
    read and written in the namespace the project actually lives in.
14. `EditorApp` header/dialog seeding: a project whose chart has no name still
    shows `projectMeta.name`, not `Unknown Name` (the O2 guard).

Export (Phase 4):

15. `assembleChartFiles({chartDoc})` preserves `extraIniFields` and
    `loading_phrase` in the emitted `song.ini`; the `chartText` path behaves as
    before. Existing `lib/chart-export/__tests__/assemble-*.test.ts` updated,
    not deleted.
16. `.sng` export of a package whose ini carries `diff_drums` puts it in the
    SNG header.

Browser (chrome-devtools MCP, per CLAUDE.md): on `/chart-editor` and
`/drum-transcription` — set album/genre/year/`diff_drums`, hard-reload, reopen
the dialog and confirm the values (and that the header still shows the real
song name, not `Unknown Name`); export and inspect the `song.ini` in the zip;
check the console and the OPFS listing for the new file.

---

## 11. Out of scope

- Any new UI. The dialog already collects everything.
- Making ini fields the dialog does not edit (`icon`, `album_track`,
  `preview_start_time`, …) editable. They ride along in the document.
- `ProjectMetadata.sngMetadata` — dead on read; left in place, and explicitly
  not made a metadata source.
- `loadFilesForExport` (`opfsProjectStore.ts:424`) — no callers; not wired in.
- Moving `audioAnchor`/`assistProvenance` into the ini. They have no ini
  representation and scan-chart would drop them.
- Album art / passthrough asset export from `/chart-editor` (it passes no
  `getExtraAssets`, so album art is dropped on export). Real bug, separate plan.
- Fixing scan-chart's ini quirks (`icon` clearing, `"0"` as unset,
  `Number(Difficulty) || undefined`). Documented in §8; upstream work.
- `.mid` ↔ `.chart` conversion, leading-silence padding, the stem cache.

---

## 12. Objections considered

An adversarial review of the first draft produced ten objections. What changed,
and what did not:

**O1 — "ini wins" is dense-over-sparse; the draft's migration was inverted.**
_Conceded, and it was fatal._ `extractSongMetadata` fills every key with
defaults (`index.js:387-476`) and `parseChartAndIni` spreads that whole object
over the chart's (`index.js:5364`). The draft's `stripChartCarriedIniFields`
(remove identity keys from the ini so "the chart wins") would have made the ini
contribute `"Unknown Artist"` instead of contributing nothing — resetting
identity on exactly the legacy projects it was written to protect. Removed
entirely. Replaced by D2's explicit merge, and by test §10.5, which encodes the
failure so it cannot come back.

**O2 — defaults leak into hosts that guard on truthiness.** _Conceded._
`EditorApp.tsx:730-732` uses `chart.metadata.name || projectMeta?.name`;
`"Unknown Name"` is truthy. Added `stripDefaultIniMetadata` as a required
Phase-1 item (D2 step 2) plus test §10.14. Also noted that this is not purely
hypothetical: audio-only drum-transcription projects, whose generated doc has
empty metadata, would otherwise have started reloading as
`Unknown Name by Unknown Artist` on day one.

**O3 — D4 cited the wrong file and fixed the wrong host.** _Conceded._
`EditorApp.tsx:493-509` is the `CloneHeroRenderer` memo; the dialog seed is
`:730-732` and already prefers the doc. `TrackEditPage.tsx:803-805` is the one
that seeds from `ProjectMetadata` unconditionally. D4 inverted.

**O4 — a third identity copy in `ProjectMetadata` will drift.** _Partly
conceded._ The claim that the list "keeps showing the stale name forever" is
too strong for `/chart-editor`: `handleMetadataChange` already mirrors
`name`/`artist`/`charter` into the project record on every dialog save
(`TrackEditPage.tsx:750-758`). It is correct for `/drum-transcription`, which
writes only a composed `name` and never `artist`. Answered by D5, which names
the record a display denormalization and makes both hosts refresh it, rather
than by trying to eliminate the copy (the projects list must be readable
without parsing every project's chart).

**O5 — `iniChartModifiers` change the chart parse on legacy projects.**
_Conceded on the facts, disagreed on the remedy._ The reviewer wanted the
legacy paths pinned to the chart-only modifiers. We do the opposite
deliberately: parsing a five-lane chart as five-lane is the correct reading and
is how the same folder parsed at import and how Clone Hero reads it. Pinning
would freeze a misparse in place. §6 now calls the change out explicitly
instead of claiming "behavior is unchanged", and §10.6 tests it.

**O6 — text-level ini filtering is unsafe (key case, aliases, encoding).**
_Conceded and moot._ `stripChartCarriedIniFields` is gone; nothing in the plan
manipulates ini text. Its supporting point stands and is worth recording: a
`song.ini` with capitalized keys is invisible to `extractSongMetadata` (which
looks up exact lowercase literals) and lands wholesale in `extraIniFields`
(`index.js:459-464`). Under D2 that is harmless — those keys round-trip
verbatim through `writeIniFile` — but it means "recovered `diff_drums`" is
best-effort for oddly-cased community inis.

**O7 — the stored `notes.chart` is not the imported file.** _Conceded, and it
made the plan simpler._ Because `createProject` stores a re-serialization of
the ini-merged doc (`TrackEditPage.tsx:249-252`), the chart and ini already
agree at import, so a legacy ini can only contribute fields the chart never
carried. That is what collapsed the draft's two migration rules into §6's one.

**O8 — Phase 4 is scope creep.** _Partly conceded._ It stays, because
persisting `extraIniFields`/`delay`/`icon` and then dropping them at the only
hop the user actually receives makes the feature half-work, and the change is
small (the `chartDoc` branch of `assembleChartFiles` already exists). But the
reviewer's ordering argument is right and is now binding: Phase 4 lands
**after** Phases 1-3, never before, and is explicitly severable into its own
plan.

**O9 — reopen the JSON alternative.** _Considered seriously, still declined,
and §4-A now argues it on the merits instead of the strawman the draft used._
The reviewer is right that `IniMetadata` is plain JSON, that no field
enumeration is needed, and that A sidesteps O1/O2/O5/O6 by construction. The
deciding argument against it: `writeIniFile` is the only door to a real
`song.ini`, so A's extra fidelity is fidelity the exported artifact cannot
carry — it would let the editor remember values Clone Hero will never see. D1
stores what it ships. If the lossy fields (§8) ever become editable, A should
win.

**O10 — the `song.edited.ini` split is ceremony.** _Conceded._ With D2, a
stale ini cannot clobber anything the chart carries, so the discriminator has
no job. D3 now specifies a single `song.ini` overwritten on every save.

**Misses the reviewer caught, now in the plan:** legacy-namespace resolution
(§5a, test §10.13); the existing `TrackEditPage` store-mock tests and
`assemble-*` tests that will need updating (§9); `regenerateProject` needing to
rewrite the ini (§5b); `icon` lowercasing/clearing, `"0"`/`"-1"`-as-unset,
empty-string clearing, and `chart_offset`/`extraChartSongFields` still being
lost on `.mid` (§8 "known lossy fields").
