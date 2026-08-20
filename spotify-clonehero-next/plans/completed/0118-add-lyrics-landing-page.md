# 0118 — Landing page for `/add-lyrics`

Status: completed

`/add-lyrics` opens on the chart picker. The page never says what the tool
does, which models run, how big the first download is, where the alignment
goes wrong, or that the result is a draft a charter reviews. It has an
`opengraph-image.tsx` and no landing shell.

The page gets the landing shell the way `/tempo` has it: `page.tsx` keeps the
metadata, `landing/AddLyricsLanding.tsx` composes the primitives, and
`AddLyricsClient`'s entry screen is passed in as `toolEntry`.

## Scope

- Three complete landing-page variants, each shipped as real code and viewable
  in the browser.
- A hero illustration per variant, owned by the route directory.
- The `opengraph-image.tsx` reviewed against the shipped card system.
- A `metrics.ts` holding every number with its provenance.

## Where the numbers come from

`~/projects/vocal-alignment/autoresearch-phrase/results.tsv` (browser-parity
baseline `80fee35` on 30 songs, the 482-song baseline `3ab69dc`, and the exp28
Demucs-fallback rows) and `~/projects/vocal-alignment/autoresearch-syllable/`.
Model sizes come from `lib/lyrics-align/model-urls.ts` and the files those URLs
serve.

Every figure carries `script`, `measuredOn`, and `asOf`. A figure that has not
been re-confirmed against the shipped pipeline is marked provisional on the
page.

## Revision round 1 (2026-08-18)

Eli's direct feedback plus the thematic feedback carried from the difficulty
pages:

- Halved the wrong-syllable offset in both animated hero canvases
  (`SyllableAlignCanvas` 0.415 → 0.445, `PhraseTimelineCanvas` 0.545 →
  0.5725). The `ErrorScaleFigure` ruler depicts no misplacement, so it had
  nothing to halve. Verified in the browser that the miss still reads.
- Variant A lede replaced with Eli's wording ("Adding lyrics to a chart is a
  slow, monotonous, and repetitive task. This tool automatically splits and
  aligns syllables to a track."). The not-one-shot statement moved to the
  tool-entry intro, the same placement the difficulty pages use.
- All three hero captions rewritten to state the takeaway instead of
  narrating the picture.
- Corpus attribution scrubbed from copy and provenance strings: the 482-song
  eval is now "songs whose vocal charts were synced by hand", the 1,028-song
  corpus is "the reference corpus", and `PROVENANCE_NOTE` says "officially
  authored charts". "wav2vec2" dropped from copy; Demucs stays, named once
  per page as credit beside "a separation model".
- Kept, per the traps flagged in the review request: the download-size trust
  facts (§7 requires disclosure at these sizes) and the review/failure-mode
  sections (§4; alignment is not an established tool).
- Style guide updated with the caption rule, the no-corpus-naming rewrite of
  §5.1, the canonical-mechanism-phrasing rule, and the felt-burden rule.

## Revision round 2 (2026-08-18)

Eli's feedback on variant A, the live page. B and C untouched except where a
shared string forced it:

- Variant A now ends after "What it does": the measurement, drift, and
  second-pass sections are gone, along with their `METRICS` imports and the
  `DRIFTS` list. `metrics.ts` stays because B and C still state the figures.
  No measured figure is stated anywhere on the live page any more.
- Download sizes are off variant A (Eli overruled the §7 argument); the
  style guide's §7 item now records that decision for all pages.
- Vocals stems, caches, and the stem-reuse branch are off variant A; the
  shared find-the-vocals step now reads "Demucs, a separation model, pulls
  the vocals out of the mix."
- The training-data paragraph is replaced by "The forced-alignment model is
  wav2vec2." (shared `PROVENANCE_NOTE`, so B and C say it too); §3's
  canonical-phrasing rule amended so a one-line third-party credit is
  explicitly wanted.
- The tool-entry intro is Eli's exact wording; the not-one-shot sentence
  moved into variant A's trust facts, which are now a page-local list.

## Revision round 3 (2026-08-18): single-variant consolidation

Eli settled on variant A, as on the difficulty pages:

- Deleted `AddLyricsLandingWorkflow.tsx` (B), `AddLyricsLandingMeasured.tsx`
  (C), their illustrations `PhraseTimelineCanvas.tsx` and
  `ErrorScaleFigure.tsx`, `metrics.ts`, `steps.ts`, and
  `app/add-lyrics/landing-preview/` (the routes 404 now).
- `AddLyricsClient` renders `AddLyricsLanding` directly; the
  `LANDING_VARIANTS` map, `LandingVariant` type, and `variant` prop are
  gone.
- Per Eli's follow-up, the page's copy lives in the page: `ALIGN_STEPS` and
  `PROVENANCE_NOTE` are written literally inside `AddLyricsLanding.tsx`,
  byte-identical. The landing directory is now the page component plus
  `SyllableAlignCanvas.tsx`.
- With `metrics.ts` gone, no measured figure exists anywhere under
  `app/add-lyrics/`.

Follow-ups in the same round:

- `opengraph-image.tsx` redrawn as a still frame of the hero canvas:
  syllables ticked onto the waveform, "ler" corrected in green with the
  proposed position as a dashed tick at the current halved offset. Subtitle
  now says "chart editor"; label sizes come from new `OG_TYPE` steps
  (`illustrationLabel`, `illustrationSub`).
- Hero canvas type raised to match `/chart`'s lyric-syllables band (18/24 px
  syllables, 10/12 px timestamps across the sm breakpoint). Syllable onsets
  respaced from measured text widths so nothing collides at 375 px, with
  timestamps alternating between two rows on narrow strips.
- Syllables and timestamps now fade in under the sweep head with the
  family's shared ease; the reduced-motion settled frame draws everything
  fully visible.

## Rules this plan does not restate

`docs/landing-page-style-guide.md` governs the copy, the `landing-pages` skill
governs the structure, and the `og-images` skill governs the cards.
