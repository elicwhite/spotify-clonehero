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

## Non-goals

- No highway-renderer changes (plan 0075 owns that space).
- No new features beyond the section context menu and Sections card.

## Done when

- Every numbered item verified fixed in the live browser (light and
  dark), or recorded here with an owner-approved reason.
- pnpm typecheck / test / lint green (pre-existing exclusions stand).
- Thermo review approved; committed as its own commit.
