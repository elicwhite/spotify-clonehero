# 0100 — Find Music ranking: correctness and quick wins

Status: completed

## Problem

Two adversarial reviews of the `/find-music` ranking (an Opus critique, then a
Fable critique of that critique's proposals) converged on a sequencing: matching
recall and dedupe correctness beat every scoring change, one diversity cap beats
the entire rescaling program, and no formula should change twice — so all
rescaling waits for the recency data it should be built on.

This plan implements the correctness and quick-win phases. It deliberately does
not touch the affinity/history rescaling.

## Phase 1 — correctness

1. **`group_id` dedupe.** `chorus_charts` is keyed on `md5`, so revisions of one
   chart share a `group_id` and currently count as independent variants. Keep the
   newest `modified_time` per `group_id` when hydrating a song's chart list, and
   count distinct `group_id` for the radar's "Available charts" term.
2. **Normalization recall.** `normalizeStrForMatching` strips parenthetical and
   bracketed editions but not Spotify's hyphen-suffix convention
   (`Song - Remastered 2011`), and treats `&` and `and` as different. Add a
   curated edition-suffix strip, `&`/`+` → `and`, and featured-artist marker
   stripping. Renormalize every stored normalized column.
3. **Exclusion semantics.** A charter exclusion should strip the offending chart
   variant and drop the row only when nothing survives, matching the instrument
   filter. Artist and song exclusions keep dropping the whole row.
4. **Radar candidacy.** Exclude identities already present in `local_charts` so
   installed songs do not occupy top-1200 slots.
5. **Installed tiebreak.** `installedPoints: 1` floats already-installed songs
   above uninstalled ones in ties, backwards for a tool whose primary action is
   Install. Drop the term; the install filter already persists.

## Phase 2 — ranking quick wins

6. **Per-artist diversity cap.** Radar sorts by a score that saturates, so
   `artistPlayCount DESC` (constant within an artist) becomes the real ranking
   function and the list block-sorts by artist. Cap each artist at 5 candidates
   before the 1200-identity truncation.
7. **Music default sort.** Default to plays descending when a history import
   exists, falling back to the composite score when it does not. Add the column.
8. **Chart freshness.** `modified_time` measures the scraper, not the music.
   Drop the term. Add a `first_seen` column now so a real catalog-novelty signal
   accrues for later.
9. **Dismissals.** Radar tiebreaks are fully deterministic, so the same top rows
   appear forever with no way to give negative feedback. Persist song-level and
   artist-level dismissals and honor them in candidate generation.

## Phase 3 — data capture only

10. **Playback timestamps.** The history parser reads three fields and discards
    `ts` and `ms_played`, which are present in the source files. Capture them as
    per-song aggregates. No scoring consumes them yet — recency-weighted affinity
    is a later plan, and it needs the data to accrue through a re-import first.
11. **Single scorer.** Radar scored in SQL, truncated, hydrated, then re-scored
    client-side from different inputs. Carry the SQL summary onto the row so the
    displayed score is the one that ranked.

## Explicitly out of scope

- Affinity/history rescaling to user-relative constants, and the `chart_count`
  log reshape. Both wait for the recency data from step 10 so the formula
  changes once.
- Difficulty and length filters — gated on measuring `diff_*` coverage.
- Best-variant picker and persisted instrument preferences.
- Cross-artist discovery via a precomputed similarity table.
- Skip-rate scoring: capture only. A flat `ms_played` threshold cannot separate
  a finished short song from an abandoned long one without track durations.

## Acceptance criteria

- Chart variant lists and the radar chart count contain one row per `group_id`.
- `Song - Remastered 2011` matches `Song`; `Rock & Roll` matches `Rock and Roll`.
- Excluding a charter no longer hides songs that have other charters' versions.
- No artist occupies more than 5 consecutive radar slots.
- The Music tab opens on plays descending when history is loaded.
- Dismissing a radar row removes it and it stays gone across reloads.
- Tests cover each of the above.
