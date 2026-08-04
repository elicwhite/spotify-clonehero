# 0076 - Editor polish round 2 (owner punch list, 2026-08-03)

Owner-reviewed the live editor and delivered this list. Round-1 polish
(the in-flight workflow: gutters, typography scale, dark transport,
compact site header, flush panes) may already cover some items - each
task VERIFIES against the post-round-1 tree before changing anything.
Items are quoted or faithfully paraphrased; owner wording wins over any
prior copy.

## A. Site header

1. The compact site header must include the GitHub and Discord icon
   links (the tall header has them today).
2. The compact header has a margin below it causing a gap between it
   and the sidebar/main-pane border. Remove the gap: header border sits
   flush on the editor grid.

## B. Layout / spacing (verify against round 1 first)

3. The main highway section has a gap on its left; it should sit flush.
4. The left sidebar still has too much space on its left.
5. Section titles (Chart Matrix, Chart Assist, Stems) are still too
   large; match the prototype's ~11px uppercase letterspaced labels.
6. Chart Assist button icons are too large.
7. The Cancel button on inline progress steps uses a larger font than
   its surroundings; match the compact scale.

## C. Chart Matrix

8. Remove the per-instrument three-dot menu (sloppy UX, truncates the
   instrument name). "Delete H/M/E difficulties" moves into the
   difficulty-generation Chart Assist card (per-instrument, with the
   same confirm). Instrument names render untruncated.
9. Instrument icons: use /public/assets/instruments/\*.png (guitar.png,
   bass.png, drums.png, etc.) EVERYWHERE an instrument is represented
   by an icon (matrix rows, add-instrument menu, assist cards, mixer
   rows if iconified). Exception: the Drum transcription assist card
   keeps its current tool icon.

## D. Chart Assist copy and controls

10. Tempo map Learn More prose, to the effect of (owner wording): give
    ours a try. It works best for 4/4 songs. It might choose the wrong
    downbeat, but you can select a different downbeat in the piano roll
    and it will update the generated tempo map. Having a great tempo
    map makes drum transcription significantly more accurate, so make
    sure you are happy there first, or regenerate the drum
    transcription if you update the tempo map.
11. Add leading silence prose: NOT about a count-in. Charting
    recommendations call for a certain amount of silence before the
    first notes for playability; when starting fresh from a song you
    often need silence to align a full measure. We recommend adding
    leading silence when the tempo map changes so the song starts with
    a full measure.
12. Drum transcription prose: frame as a FIRST PASS. Do not advertise
    perfection; people are expected to tweak and change things. The
    tool is a time saver that produces a good baseline significantly
    faster.
13. Lyrics card: never say "karaoke"; do not call it "vocals" (vocals
    implies pitches). It is just "Lyrics". Align copy with /add-lyrics
    (read AddLyricsClient's user-facing copy for register).
14. The Add Lyrics button styling differs from the other assist CTAs;
    unify.
15. Learn More sits on the SAME line as the CTA for every card.
16. CTA tooltip copy is far too long and single-line; shorten to a
    phrase and allow wrapping.

## E. Stems

17. Remove the "double-click a slider to reset" hint text (keep the
    double-click behavior).
18. After Chart Assist runs stem separation, the produced stems must
    appear in the Stems list (ai-separated, badged) like the prototype.
    Root cause: the /chart-editor shell (TrackEditPage) never adopted
    usePaddedAudio. Migrate TrackEditPage's editor onto usePaddedAudio
    (multi-file audio load through the hook), wire ai-separated stems
    into the list post-run, and thereby ALSO unlock the leading-silence
    action there (its disabled reason names this exact blocker; remove
    the disabled state if the migration makes it honest).

### Item 18 handoff contract (coordinator note, 2026-08-04, binding on the finisher and on review)

The opfsProjectStore change is landed separately (ProjectMetadata gains
optional `audioAnchor`; additive `updateProject(projectId, patch)`;
round-trip tests green). Whoever finishes the TrackEditPage migration
MUST satisfy all four, and reviewers must verify each:

1. Anchor persistence, both halves, or the leading-silence disabled
   reason STAYS: after `readChartForEditing`, re-attach
   `meta.audioAnchor` via `setAudioAnchor` before the doc is first
   dispatched; in `saveFn` after `writeEditedChart`, mirror
   `getAudioAnchor(state.chartDoc) ?? null` through
   `store.updateProject`. Missing either = silent permanent drift after
   reload. Store stubs in tests need `updateProject`.
2. Export parity: non-zero anchor pads the decoded original PCM per
   file (opus, WAV fallback); zero anchor keeps the verbatim raw path;
   separated stems stay out of the export.
3. The item's visible deliverable is the badge wiring:
   `stemsMixer={{stemOrigins: paddedStems}}` must actually be passed to
   `ChartEditor` (the mid-flight file computes it and drops it).
4. `fullMixPcm` must be the package's `song` stem (or first audio
   file), NOT a mixdown - the hook registers song.wav plus per-stem
   tracks, so a mixdown doubles every instrument. And AudioManager
   folds any filename containing `drums` into one track: skip an
   ai-separated drums stem when the package already ships drums audio,
   or it merges silently and gets no mixer row.

### Item 18 addendum (coordinator relay, 2026-08-04)

Status update from the Phase-2 chartAssist owner (wire-trackeditpage,
now stood down): the earlier non-typechecking JSX state is resolved -
typecheck is clean repo-wide. Outstanding, in the item-18 finisher's
area: `components/chart-editor/__tests__/track-edit-page-visibility-
seeding.test.tsx` fails (4 tests, nothing renders) because the new
separated-stems effect (TrackEditPage.tsx ~:811 ->
resolveStemFingerprint -> stem-cache) calls `crypto.subtle.digest`,
absent in jsdom; the effect's catch fires but the tree never renders.
Required fix, both halves: (a) the effect must bail gracefully when
`crypto.subtle` is unavailable (guard before probing, not just catch),
and (b) the suite gains the Node webcrypto polyfill exactly as
`app/tempo/__tests__/TempoClient.test.tsx` already does. Also for the
finisher: hosts hand the assist engine `loadAudio: LoadAssistAudio`
(lazy loadOriginalBytes + optional stemFingerprint) driving the Tempo
and Lyrics cards; the Drum transcription card takes
`drumRerunDisabledReason`; `leadingSilenceDisabledReason` passed as
undefined is the correct unlock mechanism ONCE anchor persistence
(contract above) is in.

### Item 18 completion note (2026-08-04)

W1d reports item 18 complete: leading silence unlocked honestly on
/chart-editor (playback padded, export padded, anchor persisted via
opfsProjectStore.updateProject and re-attached on load). Reviewers:
verify against the binding contract above regardless. One stale doc
line for the W2a copy owner: ChartAssist.tsx's module docstring still
says the TrackEditPage shell "runs the two audio-only tasks and passes
reasons for the other two" - it now passes a reason only for the drum
re-run; fix the docstring with the copy work.

## F. Utility cluster

19. The section tool button goes away. Replacement affordance: a
    right-click context menu on the piano roll's section strip with
    "Add section here" (plus existing rename/delete if present in the
    note context menus; follow the tempo-lane context-menu precedent in
    PianoRollTimeline).
20. Remove the keyboard-hint pills in the Snap/Speed/Loop area (G,
    -/+, [ ]); they do not carry their weight.
21. A/B loop: unclear how to set start/end. Add clarity: accessible
    labels/tooltips stating the interaction (e.g. "Set loop start at
    playhead"), and whatever minimal affordance text the control needs.
    Keep the existing interaction model; make it discoverable.

## G. Pipeline behavior

22. INVESTIGATE: "Isolating the drums" appears to run on the main
    thread (UI jank during separation). Separation inference runs in
    separation-worker; find what actually blocks the main thread during
    that step on the assist path (decode? fingerprint hashing? gzip
    cache write? opus encode? resampling in lyrics-audio?) by reading
    the assist task's main-thread work, and move the offender(s) into a
    worker or chunked async. Evidence-based: name the culprit with
    measurements or call-path proof, then fix.
23. Sections generation decouples from tempo map: generating a tempo
    map must not overwrite/regenerate section titles, and sections must
    be generatable on their own. New "Sections" assist card + task
    (LinkSeg path) with its own provenance/staleness; the tempo
    pipeline gains a flag (or the task composition splits) so each runs
    independently. Plan the pipeline-worker payload change minimally.
24. The generate-tempo-map task's "Listening to drum hits" step: the
    work is real (KS-warp aligns the grid to detected drum onsets) and
    must stay, but the step must present as tempo work. Relabel to
    "Aligning grid to drum hits" (or similar owner-tone copy) with a
    description that says why it improves the map. [If the owner would
    rather hide the step entirely, that misrepresents a long-running
    stage - relabeling chosen; noted for owner veto.]

## Per-item status (2026-08-04, code-verified; browser pass still owed)

Code state of each item on `plan-0074-phase-1` before the commit. "Code
verified" = the change is in the tree and covered by a test or read
directly; it is NOT the live-browser check the Done-when clause requires.

| #   | Status                                                                                                                       | Where                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Code verified                                                                                                                | `components/CompactSiteHeader.tsx`; `components/__tests__/SiteChrome.test.tsx`                                                                                                                                                      |
| 2   | Code verified, NEEDS BROWSER (CSS-only)                                                                                      | `SiteChrome.tsx` `SiteMain`, `app/layout.tsx`                                                                                                                                                                                       |
| 3   | Code verified, NEEDS BROWSER (CSS-only)                                                                                      | `ChartEditor.tsx` grid `pl-4` removed                                                                                                                                                                                               |
| 4   | UNRESOLVED, NEEDS BROWSER                                                                                                    | only the shared `p-4` -> `px-3` change; owner said "still too much" against the post-round-1 tree, so 4px may not settle it                                                                                                         |
| 5   | No change; round-1 state (`--ed-text-label` 10.5px) already matches the ~11px ask. NEEDS BROWSER confirm                     | `SectionHeading.tsx`, `app/globals.css`                                                                                                                                                                                             |
| 6   | No change beyond item 14; every assist button already inherits `[&_svg]:size-3` from the `xs` variant. NEEDS BROWSER confirm | `components/ui/button.tsx` (untouched)                                                                                                                                                                                              |
| 7   | Code verified                                                                                                                | `AssistRunCard.tsx`                                                                                                                                                                                                                 |
| 8   | Code verified                                                                                                                | `ChartMatrixRow.tsx`, `DifficultyGenerationCard.tsx`; `difficulty-generation-flow.test.tsx`                                                                                                                                         |
| 9   | Code verified, incl. mixer rows                                                                                              | `InstrumentIcon.tsx`, `StemsMixer.tsx`/`StemMixerRow.tsx`; `stems-mixer-icons.test.tsx`                                                                                                                                             |
| 10  | Code verified                                                                                                                | `learn-copy.ts`                                                                                                                                                                                                                     |
| 11  | Code verified                                                                                                                | `learn-copy.ts`, `LeadingSilenceCard.tsx`                                                                                                                                                                                           |
| 12  | Code verified                                                                                                                | `DrumTranscriptionCard.tsx`, `learn-copy.ts`                                                                                                                                                                                        |
| 13  | Code verified                                                                                                                | `LyricsCard.tsx`, `add-lyrics.ts` task title                                                                                                                                                                                        |
| 14  | Code verified                                                                                                                | `AddLyricsDialog.tsx`                                                                                                                                                                                                               |
| 15  | AT RISK, NEEDS BROWSER                                                                                                       | `CardShell`'s action row is `flex-wrap`; item 8 added a fourth button to the difficulty card, which may push "Learn more" onto its own line in the 290px sidebar. Not restyled blind - measure in the browser, then fix if it wraps |
| 16  | Code verified                                                                                                                | shortened reasons + `max-w-[220px] text-balance` scoped to `CardAction` (NOT to every tooltip in the app)                                                                                                                           |
| 17  | Code verified                                                                                                                | `StemsMixer.tsx`                                                                                                                                                                                                                    |
| 18  | Code verified against all four contract points                                                                               | `TrackEditPage.tsx`, `usePaddedAudio.ts`; `track-edit-page-audio.test.tsx`                                                                                                                                                          |
| 19  | Code verified                                                                                                                | `PianoRollTimeline.tsx` `buildSectionMenu`, `UtilityCluster.tsx`; `sectionContextMenu.test.tsx`                                                                                                                                     |
| 20  | Code verified                                                                                                                | `UtilityCluster.tsx`; `utility-cluster.test.tsx`                                                                                                                                                                                    |
| 21  | Code verified                                                                                                                | `LoopControls.tsx`, `UtilityCluster.tsx`                                                                                                                                                                                            |
| 22  | Partially done - see below                                                                                                   | `pcm-worker.ts`, `pcm-client.ts`, `separate-stems.ts`                                                                                                                                                                               |
| 23  | Code verified                                                                                                                | `generate-sections.ts`, `SectionsCard.tsx`, `ReplaceSectionsCommand`; `sections-generation.test.ts`                                                                                                                                 |
| 24  | Code verified                                                                                                                | `generate-tempo-map.ts`; `planned-step-order.test.ts`                                                                                                                                                                               |

### Item 22: what was found, and what is left

Call-path proof (read from `lib/audio-pipeline/separate-stems.ts`, no
profiler trace taken - so this is call-path evidence, not measurements):
during "Isolating the drums" the ONNX inference itself is already in
`separation-worker.ts`, but the surrounding main-thread work on the assist
path was:

1. `decodeAndResampleTo44k` -> soxr resample of the whole song, synchronous
   on the main thread.
2. `storeStem` -> pack + gzip of a ~90 MB full-song stem; Blink deflates one
   write in a single uninterrupted task.

Both moved into the new `lib/audio-pipeline/pcm-worker.ts` (`resample` and
`gzip-stem` jobs), driven from `pcm-client.ts` over the shared one-shot
abortable-worker contract, with the PCM transferred rather than copied.

STILL ON THE MAIN THREAD, not addressed: the vocals interleave loop and the
`left.slice()`/`right.slice()` input copies in `separate-stems.ts`, and
`encodePcmToOpus` for the vocals stem. Left for a follow-up rather than
widened blind.

### Item 18 addendum: recorded deviation

The addendum asked for (a) a `crypto.subtle` availability guard before
probing and (b) the Node webcrypto polyfill in
`track-edit-page-visibility-seeding.test.tsx`. Neither was done literally.
What actually fixed the four failing tests was moving every state write in
the separated-stems probe INSIDE its async closure, so a throw can no longer
block the render; the probe keeps its `try/catch`, and the seeding suite
mocks `lib/audio-pipeline/stem-cache` instead of polyfilling crypto. Same
guarantee, different mechanism; recorded here rather than left silent.

## Non-goals

- No highway-renderer changes (plan 0075 owns that space).
- No new features beyond the section context menu and Sections card.

## Done when

- Every numbered item verified fixed in the live browser (light and
  dark), or recorded here with an owner-approved reason.
- pnpm typecheck / test / lint green (pre-existing exclusions stand).
- Thermo review approved; committed as its own commit.
