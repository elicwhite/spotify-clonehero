# 0077 - Editor polish round 3 (owner punch list, 2026-08-04)

Owner live-tested after plans 0075/0076 landed. Items verbatim or
faithfully paraphrased; owner wording wins.

1. Multiple highways overlap when there are too many. The highways
   must SHRINK to fit their lane so they never overlap: at narrow
   viewport rects the full highway width must fit inside its own
   viewport (camera fit-to-width per lane), not crop into neighbors.
2. Pre-existing: the frets on the strikeline for DRUMS are scrunched
   together instead of correctly spaced apart. Fix drum strikeline
   fret spacing.
3. STILL WRONG after two rounds: sidebar section titles (Chart Assist
   etc.) render larger than the prototype. This round requires
   computed-style evidence: measure the served page's actual
   font-size/weight/letter-spacing for the heading and the prototype's
   (11px uppercase letterspaced), find why the prior fixes did not
   take (cascade/specificity/var not applied), fix at the true cause,
   and pin with a computed-style assertion test.
4. STILL WRONG: icons inside Chart Assist buttons are way too large
   relative to the button. Same evidence standard as item 3.
5. Transport forward/back buttons jump by SECTION on click and
   advertise cmd+left/right as their hotkey, but the hotkey moves by
   MEASURE. Fix the hotkey to move by section, matching the buttons.
6. Chart Matrix right-click context menu with: Delete instrument,
   Delete difficulty, Delete all lower difficulties. OWNER OVERRIDE
   (2026-08-04): this reintroduces per-difficulty deletion, superseding
   the earlier set-only deletion rule; encode all three as undoable
   commands (delete-instrument and delete-difficulty may need new
   commands following DeleteLowerDifficultiesCommand's pattern,
   affectedTracks/provenance handled: deleting Expert with generated
   lowers should also drop that provenance entry; deleting the last
   visible track respects the at-least-one-visible invariant).

Done when: each item browser-verified (items 1-4 visually, 5 by
hotkey behavior, 6 by interaction), typecheck/test/lint green
(pre-existing exclusions stand), thermo approved, own commit.
