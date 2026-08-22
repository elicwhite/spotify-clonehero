# 0122 — Make /storage a page you can manage storage from

Status: in-progress

## What is wrong with it

`/storage` reports five numbers in one flat list:

```
Used by this site      700 MB of 1000 MB (70%)
Your charts and audio  3 projects, 60 MB
Separated stems        2 songs, 200 MB
Downloaded models      336 MB
Everything else        104 MB
Your charts kept …     Yes
```

Three problems, all the same problem:

- **Nothing says the first row contains the other four.** They are rendered as
  five siblings, so a reader has to work out the arithmetic to see there is a
  hierarchy at all.
- **The one button frees the stems, and only the stems row carries a size a
  button could act on.** Every other row is a number you can read and do
  nothing about, which makes the page a report rather than a place to manage
  anything.
- **The charts are a single line.** A user who is out of room needs to know
  which chart is large, and to be able to remove one — the page names the thing
  they care about most and then offers no way to act on it.

## The shape

**One total, then two groups, split by what happens to them under pressure.**
That is the honest hierarchy: the browser treats these two groups differently,
so the page should too.

1. **A usage bar.** One stacked bar against the quota, segmented into charts,
   stems, models and everything else, with the legend carrying the figures. The
   containment is then visible rather than arithmetic. The persistence state
   reads beside it, with the ask button where a browser has not already
   answered.

2. **Your charts — kept.** A row per project: name and artist, size, when it
   was last edited. Each row gets **Download** and **Delete**. Download writes a
   zip of the project directory exactly as it is on disk, which is a real backup
   and needs no chart parsing, no format choice and no re-serialization — the
   point is to let someone take a copy before they delete it. Delete confirms
   first.

   The databases sit under the same heading as one row, undeletable: they hold
   the song library and the practice history, and there is no per-item story to
   tell about them here.

3. **Rebuildable — safe to free.** Stems, a row per cached song, labelled with
   the chart whose `stemFingerprint` matches, and "Not linked to a chart" where
   none does. Each row deletable, plus one button that frees them all. Models as
   one row, deletable, labelled with what deleting costs.

## What each part reads

Everything comes from modules the page already uses. The additions:

- `measureProjectStorage` returns the projects rather than only their total:
  id, namespace, name, artist, size, last edited, and `stemFingerprint`. It
  reads `metadata.json` directly rather than going through `projects.ts`, which
  would pull the chart parser and the editor core into this page.
- `deleteStoredProject(namespace, id)` — a recursive remove.
- `ChartExportDialog` reads one project and hands it to the editor's export
  dialog. Two layouts live in OPFS and the namespace is what says which store
  can read a project, so it dispatches on that: reading a transcription project
  through the chart-package store answers "not found". It passes the whole
  document, rebuilt from the chart file plus `song.ini` — a chart file alone
  carries no `song.ini` surface, so album, year, genre and the per-instrument
  intensities would be missing from a copy taken here.
- `ExportDialog` gains controlled `open`/`onOpenChange`, so one dialog can
  serve a list, and `showChartCheck`, which also skips the scan rather than
  hiding its result.
- Everything the dialog needs is imported dynamically. A page that reports
  numbers should not ship the chart parser.

## Out of scope

- Renaming or editing anything from this page. It manages storage, not charts.
- Deleting a single stem *file* rather than a song's whole entry. Half an entry
  is a cache miss that still occupies the disk.
- Editing what is exported. The dialog offers `.zip` and `.sng` and reads the
  song details from the chart, exactly as it does in the editor.

## Verify

- Unit tests: the per-project listing including a directory with no metadata,
  delete removing exactly one project, the stem-to-chart labelling including an
  unmatched fingerprint, the bar segments summing to the reported usage, both
  export layouts, and every action reporting what it actually did rather than
  what it hoped.
- In the browser: a planted project and stem, exported, deleted, and the
  figures moving accordingly.
