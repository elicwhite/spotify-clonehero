# 0128 — Audio to drum sheet music, for drummers

Status: todo

**Revision 3.** Two contrarian reviews. The first found that the chart and the
audio do not start at the same place, which revision 1 had no stage to catch.
The second found that the negative `delay` revision 2 introduced throws on the
seek path, that it would clobber an imported chart's own delay, and that the
"play along with the drums muted" stage cannot work at all — the drum stem is
not cached in a form the viewer can read, and no accompaniment stem exists
anywhere. Both reviews' verified findings are folded in below. What each
review confirmed as correct is recorded too, so no stage re-argues it.

A drummer puts in a song. The tool gives back drum sheet music that the
drummer can read and play along to. The chart editor is not part of the flow.

## The problem

`/drum-transcription` makes a drum chart from audio and then opens
`/chart-editor`. That is correct for a charter, who wants to correct the notes
and export a chart. It is wrong for a drummer, who wants to read the part.

| | Charter (`/drum-transcription`) | Drummer (this plan) |
| --- | --- | --- |
| Wants | An accurate chart file | A readable page of music |
| Result screen | Highway editor | Sheet music |
| Ends with | An export (`.zip` / `.sng`) | Playing along |
| Accepts | A 515 MB model download, a WebGPU-only browser, and manual repair | Very little of this |

## Settled decisions

- **`/sheet-music` plays a project from OPFS**, addressed as `?project=<id>`.
- **`/sheet-music/create` is the entry**: its own landing page, its own
  browser gate, its own cohort.
- **The search null state does not link to `/create`.** Different cohorts;
  only the final experience is shared.
- **Projects are stored and resumable**, with their own `ProjectOrigin`.
- **This flow adds no padding.** It never plans a lead-in. It only carries a
  shift that is already on disk.
- **The synthetic intro stays.** The tempo map writes something at tick 0 to
  satisfy `ms(tick 0) = 0` — a partial first bar, a stretched opening BPM, or
  a collapse marker. It shows on the page as it is, and bar numbers may be off
  by one. The repo owner accepts this. Do not repair it, hide it, or re-tick
  the chart.

## What is already true (verified, do not re-argue)

- `SongView` survives `md5: ''`. `useAutoScroll` bails on an empty `songKey`
  (`useAutoScroll.ts:44,55`).
- `AudioManager` decodes `{fileName, data: Uint8Array}` with `decodeAudioData`
  (`lib/preview/audioManager.ts`), so a stored `original.<ext>` or
  `song.opus` blob is the right format, and one entry in `audioFiles` is
  enough.
- **With a null anchor, chart ms 0 is audio ms 0.** `storeAudioOriginal` keeps
  the uploaded bytes verbatim (`opfs.ts:679-697`), the pipeline decodes those
  same bytes, and phase-align is a bounded ±80 ms shift of note placement
  inside that timeline, not a move of the origin. So the normal case needs no
  offset at all.
- `applyDocSidecars` is exported from `lib/chart-edit` (`index.ts:142`) and
  `ProjectMetadata extends StoredDocSidecars` in both stores, so the adapter
  can re-attach the anchor the way `EditorApp.tsx:386` does.
- `delay` reaches `ParsedChart.metadata` through `iniChartModifiers`
  (`chorus-chart-processing.ts:56-58`), and `getChartDelayMs` is its only
  reader in `SongView`.
- The click track tolerates a negative delay: `generateClickVoicePcm` shortens
  the buffer (`generateClickTrack.ts:147`) and `mixSamples` bounds-guards a
  negative index (`clickTrack.ts:125-130`), so pre-audio clicks are dropped.
- `getMd5FromSlug` requires 32 characters on the last dash-segment, so a
  project id can never route to `[slug]`, and `create` cannot shadow a chart.

## Routes

| Route | Job |
| --- | --- |
| `/sheet-music` | Search, the local-file picker, and `?project=<id>` |
| `/sheet-music/[slug]` | One Chorus chart. **Unchanged by this plan.** |
| `/sheet-music/create` | Landing page, browser gate, file picker, the run, and the songs made here |

**Non-goal: do not change `getMd5FromSlug`, and do not host a project under
`[slug]`.** Public URLs of the form
`/sheet-music/The%20Only-Static-X-bab194b5…` are read by three server paths —
the page, `generateMetadata`, and `opengraph-image.tsx` — all through that
helper. A project id (`<base36 time>-<6 chars>`, `opfs.ts:218-223`) fails its
test, and widening the test would spend the `song-artist-hash` contract on a
case with no song, no artist and no hash.

A local song has no server-side identity: nothing is uploaded, so the server
cannot name it. `/sheet-music?project=` keeps the search page's generic
metadata and card. The id is an opaque local string.

## Stages

Stages 1 and 2 are independent of everything else and fix live bugs. Ship them
first.

### Stage 1 — clamp the audio offset at zero

`playChartTime` computes `chartTimeSec + this.#chartDelay`
(`audioManager.ts:711`) and hands it down to `source.start(at, offset)`
(`audioManager.ts:1101`). A negative `offset` on `AudioBufferSourceNode.start`
is a `RangeError` by specification, and nothing on the path clamps —
`SongView.tsx:1399` (`onSelectMeasure`) and `:476` (`loadSection`) both reach
it.

This is a live bug today: an imported chart with a negative `delay` or
`chart_offset` means "the chart starts before the audio", and clicking a
measure in that region throws. It also blocks stage 3, which introduces a
negative delay deliberately.

Clamp the audio offset to zero in `AudioManager`, and keep the chart position
the caller asked for, so the playhead still lands on the clicked measure while
the audio starts at its first sample.

### Stage 2 — hide what a local chart cannot do

`SongView` reads `metadata.md5` for favourites and practice sections. Hide
those controls when the chart has no Encore identity.

Revision 2 called the calls "inert". They are not: `savePracticeSection('')`
reaches `ensureSongExists`, which calls `searchAdvanced({hash: ''})`
(`app/sheet-music/[slug]/actions.ts:8-38`) — an outbound Encore request with
an empty hash. Inert on Supabase only.

This fixes the existing local-file path as well.

**Coordinate with plan 0127** (`sheet-music-listen-and-follow`, stages 1–3
built). It owns `SongView`'s autoscroll path and `useAutoScroll`, which
consumes `audioFiles` and `chartDelaySec`.

### Stage 3 — `projectToLocalChart`

New module in `lib/`. Takes a project id, returns what the viewer needs. This
is the correctness surface of the plan.

**Dispatch on layout.** `findProject(id)` returns a `ProjectRecord` with
`layout`. The two layouts do not share a reader:

| Layout | Chart | Audio |
| --- | --- | --- |
| `drum-transcription` | `findProjectChartFile` → `readProjectBinary` | `readOriginalAudio`, else `readSongOpus` |
| `chart-package` | `chartPackageStore().readChartFile(id)` / `readSongIni(id)` | that store's own audio reader |

Two storage APIs, not one `if`.

**Parse with `readChart(files, {pro_drums: true})`** — the same call
`EditorApp.tsx:358-362`, `projects.ts:251` and `transcribe-drums.ts:242` make.
`convertToVexFlow` depends on it through `interpretDrumNote`
(`convertToVexflow.ts:129`); without it a cymbal notates as a tom. Not
`readChartForEditing`, which forces the flag only for `fourLane`.

**Refuse what cannot be shown**, each with its own message: no such project;
`ready` false; no drums track; `hasAudio` false; and a legacy `full.pcm`-only
project, whose only reader is `loadFullMixPcm` and returns `Float32Array`,
which `Files` cannot carry.

**Carry the shift, never make one.** Apply the sidecars, then read
`getAudioAnchor(doc)`:

- **anchor null** — the normal case — `delay` keeps whatever the chart's own
  metadata says, usually 0. Plan no pad.
  `lib/assist/tasks/add-leading-silence.ts` is never called from this path.
- **anchor set** — `delay = existingDelayMs - anchor.ms`.

Two corrections revision 2 got wrong, both verified:

- **Combine, do not replace.** `getChartDelayMs` takes `delay` in precedence
  and never combines it with `chart_offset` (`chartDelay.ts:21-27`). A
  `chart-package` project is an imported chart whose `song.ini` may already
  carry one, and the Done-when list requires those projects to play.
- **The anchor is signed.** `anchorShiftSamples` says so: "a positive count is
  silence to prepend, a negative one is audio to take off the front"
  (`useShiftedAudio.ts:147-158`). A trim puts chart ms 0 at a positive audio
  time. The formula generalizes; the tests must cover both directions.

**`song_length`.** `runner.ts` writes only the chart file and discards the
`song.ini` that `writeChartFolder` produced, so a never-edited project has no
ini, and `SongView` falls back to a 5-minute song (`:908`) and reports 0 ms to
the playback bar (`:1358`). Use `ProjectRecord.durationSeconds * 1000`, with a
null branch — the field is null until the audio is decoded (`types.ts:96-98`).
`PlaybackBar` works in audio time, which is the right domain, but a padded
chart's notation runs past the audio by the pad, so the last bars sit beyond
the slider's end. State that behaviour rather than discovering it.

**`LocalChart` does not fit as declared.** It requires `loaded: LoadedFiles`
and `chartDoc` (`LocalChartLoader.tsx:15-22`), and a project has no
`LoadedFiles`. The viewer reads neither (`Search.tsx:238-242` passes only
`metadata`, `chart`, `audioFiles`), but `/preview/Search.tsx:121` does. Narrow
the viewer's input to the three fields it uses, and leave the file-drop
callers on the wider shape. Note that the synthetic `ChartResponseEncore`
literal this plan moves into `lib/` is declared today in `components/`.

**Tests.** Use `lib/drum-transcription/storage/__tests__/fake-project-opfs.ts`.
Assert alignment directly in three states — no anchor, a positive anchor, and
a negative anchor: build a project whose first drum note is at a known audio
millisecond and check `noteChartMs + delay === expectedAudioMs`. Add a case
for a `chart-package` project whose `song.ini` already carries a delay. Add a
seek case, or stage 1's clamp has no regression test where it matters.

### Stage 4 — `/sheet-music?project=<id>`

`app/sheet-music/page.tsx` is a server component whose `searchParams` type
names only `{q, instrument}`, and `Search`'s `defaultResults: EncoreResponse`
is non-nullable and seeds both `filteredSongs` and the infinite-scroll
effect's dependencies. **There is also a second search**: `Search.tsx:158-166`
runs `searchSongs(searchQuery)` in an effect on every mount, and hooks run
before the `localChart` early return at `:227`. So a viewer load hits Encore
twice unless both are gated. Decide whether to gate them or to accept the
requests; do not describe it as one line.

Seed `localChart` from `projectToLocalChart` when the parameter is set. The
existing `localChart` branch then renders the same `SongView` for both
sources.

**The parameter stays in the URL**, so the address is durable. "Back to
search" must therefore navigate (`router.push('/sheet-music')`), not only
clear state, or Back re-enters the viewer.

The search UI renders server-side, so a `?project=` load shows the search page
for a moment before the viewer swaps in. Decide whether that flash is
acceptable or whether the server should render a neutral shell when the
parameter is present.

A bad id shows a message and the search page, never an empty viewer.

`SongView` is not keyed by chart in `Search.tsx:238`, and `selectedDifficulty`
is a `useState` initializer that throws `'Unable to find difficulty'` when it
misses (`SongView.tsx:185-190, 495`). Durable URLs make project-to-project
navigation without an unmount plausible. Key the component, or verify it
remounts.

### Stage 5 — the run shell, extracted

Revision 1 claimed none of this state machine is specific to the editor
hand-off. False: `router.replace('/chart-editor?project=…')` on three branches
(`DrumTranscriptionClient.tsx:214,227,234`), `handleSelectProject` branching
into it on `record.ready`, and `openNewChart` hard-coding
`origin: 'drum-transcription'` (`:296`).

So the extraction parameterizes the destination and the origin. Keep the
entrypoint literal at each page and pass it in — **this stage and stage 6 both
break `components/assist/__tests__/run-entrypoints.test.ts:83-87`**, which
asserts exact set equality of the files that declare a run entrypoint. A hook
that holds the literal removes that guard silently instead of tripping it.

If parameterizing the resume path gets ugly, share less: the run, retry and
cancel part, without the resume router.

### Stage 6 — `/sheet-music/create`

- `page.tsx` + a client, using the hook from stage 5 with the new origin.
- A landing page from `components/landing` primitives (`design-system`
  skill). `/sheet-music` has no landing page today.
- An OG card from `lib/og`. `og-routes.test.ts:29-51` discovers it
  automatically and enforces `OG_SIZE`, a non-empty `alt`, `contentType`, and
  no raw hex.
- The browser gate **above the file picker**, in the landing copy. The
  capability gate in `DrumTranscriptionClient` renders only after the check
  resolves, which is too late for this audience.
- On success, `router.push('/sheet-music?project=' + id)`.
- The list of songs made here. Say what a **not-ready** project does when
  picked: a run abandoned mid-flight leaves one, and this page must resume it
  rather than open an empty viewer.

The run aborts on unmount (the assist runner is page-scoped,
`AssistRunnerProvider.tsx`), so the redirect happens after the run finishes.

### Stage 7 — the new origin, and where these projects go

`ProjectOrigin` (`types.ts:16`) is a closed union, but "the compiler names
every site" is overstated. Only two totality constraints exist:
`ALL_PROJECT_ORIGINS` (`types.ts:59`) and `ORIGIN_LABEL`
(`components/project-list/ProjectList.tsx:37`). Everything else compares. And
`LandingTool = Exclude<ProjectOrigin, 'chart-editor'>`
(`lib/analytics/track.ts:10`) **auto-widens**: the new origin silently becomes
a valid analytics value with no site named at all. Walk the origin comparisons
by hand.

Three placements to decide: `/chart-editor`'s list (it lists everything), the
storage page (`plans/in-progress/0122-storage-page-management.md`), and what
`ChartOrigin` reports for a chart opened from the viewer.

**One redirect has no owner today.** `TrackEditPage.tsx:261,386` hard-code
`router.replace('/drum-transcription?project=…')` for any `!record.ready`
project. A drummer's half-finished project opened from anywhere lands in the
charter tool. Route by origin here.

**Analytics.** `sheet_music_loaded` reports `slug: metadata.md5`
(`SongView.tsx:207`), which is `''` for every project view and for every
local-file view alike. Add a source dimension, or this flow ships unable to
count itself in a repo that has a test enforcing entrypoint attribution.

### Stage 8 — measure the tempo map before announcing the page

`plans/completed/0061-appendix-research-findings.md` defines **keepable-%** —
whether a predicted tempo map is one a user would keep as-is — over a
1022-song corpus with ground truth, and reports a worst-scoring 191-song
cohort and a 13.3% op-disagreement rate driven by half/double and meter
errors. The corpus and harness live in the research repo, not here.

Read the result as a drummer, not a charter: a half or double tempo error
gives a readable page with wrong note values; a meter error gives an
unreadable one.

**Set the threshold before running it**, and say what happens if it fails.
Without a number agreed in advance this stage cannot fail, and it sits after
seven stages of build.

## Out of scope: play along with the drums muted

This was stage 7 of revision 2, described as "one added entry to
`audioFiles`". It cannot work, for three verified reasons:

1. **There is no accompaniment stem.** `EditorApp.tsx:771` states it: "only
   the drum stem is ever separated, so this is always the full mix." Adding
   the drum stem beside the full mix **doubles** the drums; muting that track
   leaves the mix's drums audible. The editor mutes separated stems by default
   (`useShiftedAudio.ts:335-338`) to avoid exactly this, while `SongView` sets
   every track to volume 1 (`SongView.tsx:608-616`).
2. **The drum stem is not stored in a readable form.** `separate-stems.ts:220`
   writes it with `storeStemBytes` — gzip'd packed Float32. Only vocals get
   `storeStemOpus` (`:231`). So `loadStemOpus(fp, 'drums')` always returns
   null, and the export path Opus-encodes the stem on the fly with WebCodecs
   (`EditorApp.tsx:734-752`).
3. **There is no fingerprint to look it up with.** `loadStemOpus` takes a
   stem-cache fingerprint, not a project id, and nothing stores that
   fingerprint in project metadata. The adapter would have to recompute it
   over the original file bytes plus `ROFORMER_SEPARATOR_ID`
   (`stem-cache.ts:65-97`), including the "no stored original" fallback.

A real version needs mix-minus-drums, which means subtracting the drum stem
from the full mix. That is its own plan. It also depends on
`plans/in-progress/0123-separate-stems-on-demand.md` and on
`plans/in-progress/0066-unified-stem-cache-and-audio-session.md`, which owns
`stem-cache.ts`.

## Risks

**The anchor mechanism is unshipped work.** Both `0064-leading-silence-padding`
and `0124-own-the-opening` are still in `plans/in-progress/`, and 0124 is at
revision 10 after a class of bugs where "the chart jumped under the user".
Stage 3 reads `audioAnchor`, so it is building on a field that is still
moving. Re-read both before stage 3, and keep the adapter's use read-only.

**The browser gate turns away part of the audience.** WebGPU and WebCodecs,
plus about 515 MB of models on the first run. A drummer on an iPad or Safari
cannot use the tool. Say so before the file picker.

**Storage grows fast.** Each song keeps a verbatim original plus stems. Stage
7 decides where these projects surface so a drummer can find and delete them.

**Nothing is uploaded.** OPFS for the project, WebGPU for the models.

## Done when

- A drummer drops one audio file on `/sheet-music/create` and reaches readable
  drum sheet music without seeing a highway.
- **A note the drummer hears at audio time T is drawn at the position the
  playhead reaches at T**, on a project that was never opened in the editor,
  one padded in the editor, one trimmed in the editor, and a `chart-package`
  project whose `song.ini` carries its own delay. No lead-in is added in any
  case.
- Clicking a measure in the lead-in region seeks instead of throwing.
- The song reports its real length in the playback bar.
- `/sheet-music?project=<id>` plays that song after a reload, and plays a
  `chart-package` project as well.
- The song is in the list on `/sheet-music/create` on the next visit, and
  reopens with no pipeline run. A not-ready project resumes instead.
- The search results and the search null state are unchanged.
- A shared chart URL such as
  `/sheet-music/The%20Only-Static-X-bab194b582f741e8d9b8f0d26cc451df` still
  loads, still gets its title, and still gets its social card.
  `getMd5FromSlug` is byte-for-byte unchanged.
- `/drum-transcription` behaves exactly as before.
- `run-entrypoints.test.ts` and `og-routes.test.ts` pass with the new page in
  their discovered sets.
- `pnpm test`, `pnpm typecheck` and `pnpm lint` pass.
