---
title: Landing Page Copy & Ethos Style Guide (living)
type: concept
scope: Marketing/landing pages for Music Charts Tools (/chart-editor, /drum-transcription, /add-lyrics, /drum-difficulties, /guitar-difficulties, /tempo)
sources:
  - ~/projects/drum-to-chart/wiki/paper-style-guide.md
  - "~/projects/drum-to-chart/wiki/AI charting Ethos.md"
  - Eli's decisions on the first landing-page draft, 2026-08-06
created: 2026-08-06
updated: 2026-08-19
---

# Landing Page Copy & Ethos Style Guide (living)

Rules for writing copy on tool landing pages. Read this before drafting or revising any
page. It is a living document: **add a rule whenever feedback expresses a preference that
generalizes beyond one page, and update existing rules when later feedback refines them.**

The paper style guide governs prose mechanics (humility, precision, no em-dash pivots, no
"not X, but Y", every number traces to a source). Those rules apply here unchanged. This
guide adds what is specific to a public page selling a tool to a skeptical community.

This document governs **copy**. Its structural sibling, `docs/design-system.md`, governs
which components a page is built from and which tokens exist. Several components encode
rules from this guide — `TrustLine` because of §7, `ComparisonTable`'s missing verdict slot
because of §5.2 — so a change here may need a change there.

## 1. Who is reading, and what they distrust

The audience is the Clone Hero / YARG charting community: charters, aspiring charters, and
players who chart for themselves. Assume the reader:

- Charts by hand, cares about chart quality, and holds a high bar for what ships.
- Is hostile to AI-generated charts and to "vibe-coded" tools. They have seen slop uploaded
  and it cost other people time.
- Has watched their own charts get scraped and used as training data, and is uneasy about it.
- Reads marketing language as a tell that the author is hiding something.
- Will check your claims. Some of them will download the page's model, run it on a song they
  know, and post the result.

What that implies:

- Overclaiming is the fastest way to lose them. Underclaiming costs almost nothing.
- Precision reads as respect. Vagueness reads as evasion.
- Concreteness about failure modes buys more trust than any positive claim.
- Never write anything you would be embarrassed to defend in a Discord thread with a
  charter who has 400 charts published.

| Don't | Do |
|---|---|
| "Charting has never been easier." | "The output is a starting point you edit, not a finished chart." |
| "Trusted by charters everywhere." | Say nothing, or state a specific measured fact you can source. |
| Hint that the tool avoids machine learning to dodge the objection | Name the model plainly and describe where it fails. |

## 2. Voice and register

**Neutral tool voice.** The page describes what the tool does and does not do, in plain
factual register. It is closer to a manual page than to an ad.

- No first-person narrator. No "I built this because…", no "we believe…". (Eli's ethos
  writing is first-person; landing pages are not. If a first-person note is wanted, it is a
  separate, clearly-attributed page, not the product copy.)
- No brand personality. No jokes at the reader's expense, no exclamation points, no
  "your new favorite…", no mascot-speak.
- Second person is fine and preferred over passive constructions when describing what the
  reader does: "You review the output in the editor before saving."
- Sentences short. One idea per sentence. Headings say what the section is, not how it feels.
- No meta-commentary about the page ("Below, we'll walk you through…", "Let's dive in").
- No em-dashes as rhetorical pivots, and no "not X, but Y" constructions. Recast with
  commas, periods, or two sentences.
- No rhetorical questions as headings ("Tired of charting drums by hand?").
- Structural numbering (01/02/03 section eyebrows, numbered step markers) only where order
  carries real information, i.e. an actual sequence the reader follows. A landing page's
  sections are not a staged pipeline; do not number them.

**The hero lede sells the purpose, not the plumbing.** A lede that only enumerates
mechanism ("three models run, one separates, one proposes…") says what the tool does, not
what it is for, and gives the reader no reason to want it. The lede states the goal in
ethos terms: charting takes time, this does the first pass, your time goes to review and
judgment. Nothing grandiose; the mechanism moves down into the what-it-does section.
Related: every noun must have a referent by the time it appears ("the draft" means nothing
to a reader who hasn't been told a draft exists yet).

| Don't | Do |
|---|---|
| "We built the tempo tool to take the pain out of tempo mapping." | "The tempo tool proposes a tempo map from the audio. You adjust the downbeats it gets wrong." |
| "It's not a chart generator — it's a co-pilot." | "It produces a first pass. A charter reviews and edits it." |
| "Ready to chart faster? Let's go!" | "Open the tool" (as the button label, with no surrounding hype). |
| "Blazing fast, right in your browser!" | "Runs in your browser. Nothing is uploaded." |

**Only assert a burden the reader actually feels.** A page may name the pain the tool
removes only where that pain is the reader's common experience (placing every syllable
by hand really is the whole job of adding lyrics). Do not manufacture a burden to make
the tool look necessary: most charters never wrote four difficulty tiers by hand, so
"charting one song means charting it four times" argues a suffering the reader does not
recognize, and it reads as a sales move. Where the burden is real, state it once (the
lede is the natural place) and stop; no other paragraph should be arguing that the
reader is suffering.

| Don't | Do |
|---|---|
| "Charting one song means charting it four times." (most charters don't) | "This tool adds Hard, Medium, and Easy from the Expert track." |
| Re-stating the pain in every section intro | State it once in the lede; the rest of the page describes the tool. |

**Illustration captions describe the effect, not the picture.** A caption that narrates
what the illustration depicts is alt text, and alt text is not copy. The caption states
the takeaway the reader should leave with, which on these pages is usually what the tool
gets right and what the reader will fix in the editor. The model is /drum-transcription's
hero caption: "Above: the model's predicted notes need some edits, like moving a cymbal
to the right lane, removing a note that was never played, or nudging a note onto the
beat. Make those fixes in the chart editor."

| Don't | Do |
|---|---|
| "Above: one syllable lands early, and a person drags it onto the vocal." | "Above: most syllables land where they are sung. The ones that land off the vocal are yours to drag into place in the chart editor." |

## 3. How to talk about the technology

**Precise terms, never hide.** Name the mechanism concretely. Say what it does and where it
breaks.

- Correct labels: "a transcription model", "a trained model", "decision rules fit to
  data", "a beat-tracking model", "a forced-alignment model".
- **One canonical phrasing per mechanism, on the page and across pages.** A learned
  component is "a trained model", or its job-specific form ("a trained transcription
  model", "a forced-alignment model"). Do not rotate through synonyms ("a neural
  network", the architecture name, the checkpoint name) for variety; every synonym is a
  second concept the reader has to reconcile with the first. Naming a published
  third-party model once as credit is not synonym rotation: a plain one-line credit in
  the how-it-works layer ("The forced-alignment model is wav2vec2.") is wanted, and the
  plain description still does the explaining everywhere else.
- Never the phrase "AI-powered". Never "powered by AI", "AI-driven", "smart", "intelligent",
  "magic".
- Never deny or obscure that machine learning is involved. If a tool uses a model, the page
  says so, in the section where a reader would first wonder.
- Where a component is *not* a model, say so just as concretely. Demystified mechanism
  language tested well and is encouraged: "a fixed table of numbers", "arithmetic you could
  check by hand", "measured once, then frozen", "a lookup, not a model".
- **The reader is a charter or player, not an ML practitioner.** Architecture and tooling
  jargon (CRNN, transformer, ONNX, spectrogram, F1) does not belong in landing copy; it
  lives in the how-it-works layer for readers who go looking. On the landing page, describe
  the component by its job: "a custom trained transcription model", "a beat-tracking model".
  A published third-party model may be named once as credit, but the plain description
  carries the meaning; the name must never be doing the explaining.
- **Pipeline internals stay off the page.** Describe what each component does in the
  ordinary case, once. Intermediate artifacts (a separated vocals stem, a cache), rare
  fallback branches, and retry logic are implementation details, not landing copy; a
  reader who wants them reads the how-it-works layer or the code.
- Every capability claim should be paired with its failure mode nearby, in the same visual
  block where possible. Failure modes are specific, not hedges: name the musical situation.
- **The established-category condition** (Eli's decision, 2026-08-19). The pairing above
  is required where the tool's category is new to the reader. A tool in a category the
  community already trusts and uses does not have to argue its own limits the way a novel
  one does: such a page may state its capabilities without a paired failure mode, and it
  carries no training provenance and no measured numbers (§5.1, §8). The difficulty pages
  are under this condition. The condition is the category's standing, not the author's
  preference: transcription and lyric alignment are novel to this audience, so
  /drum-transcription and /add-lyrics keep their failure modes.
- **Failure modes are priced, not just named.** Distinguish cheap fixes from expensive
  ones: a failure the reader corrects in a few edits (wrong time-signature markers on a
  good tempo grid) is a different situation from one that means redoing the work (a bad
  tempo grid). Lumping them together overstates the cheap failures and understates the
  expensive ones. If a cited number conflates the two, say so.

| Don't | Do |
|---|---|
| "AI-powered drum transcription" | "A trained transcription model listens to the audio and proposes notes." |
| "wav2vec2 with a CTC head aligns each syllable" | "A forced-alignment model places each syllable at the time it is sung." |
| "Advanced algorithms handle the rest" | "A fixed table of numbers, measured once and frozen, decides which notes to keep." |
| "Highly accurate" | "It gets kick and snare right far more often than it gets cymbal choices right. Ride vs crash is the most common thing you'll fix." |
| "Sometimes it makes mistakes." | "Double-kick passages and fast ghost notes are where it misses most." |
| Avoiding the word "model" so the page reads as hand-written rules | Say "model" where a model is used, and "table"/"rules" where those are used. |

## 4. The not-one-shot ethos (required on every page)

**Every tool page must state, in some form, that the tool is not a one-shot chart
generator.** It is a first pass that speeds up charting. The charter reviews the output and
makes tweaks. The page must never imply output ships without human review.

Placement: high on the page, near the first description of what the tool does. Not buried in
an FAQ. It is a feature statement, not a disclaimer, so it does not get disclaimer styling
(no small grey italics at the bottom).

Example phrasings (vary them; do not paste the same sentence on six pages):

- "This produces a first pass. You review it in the editor and fix what's wrong."
- "The output is a draft chart. It is not ready to upload as-is."
- "It handles the repetitive part. The judgment calls are still yours."
- "Expect to edit the result. The goal is less time typing notes, not zero time."
- "A charter still decides what ships."

| Don't | Do |
|---|---|
| "Generate a chart from any song." | "Generate a first-pass chart you then edit." |
| "Chart a song in one click." | "One click gets you a draft. Editing it is the rest of the job." |
| "Ready to play." | "Ready to open in the editor." |
| Burying "you should check the output" in an FAQ accordion | State it in the first screenful, in normal body text. |
| Using it as an apology ("Sorry, it isn't perfect yet") | State it as the design intent. The tool is *for* first passes. |

Do not soften this into "just review it quickly" or promise a specific low edit count unless
that number is measured and sourced (see §6).

## 5. Provenance and comparisons

### 5.1 Training-data and eval-corpus provenance

Do not make it a headline, and do not name the corpus. Landing copy never names whose
charts a model was trained on or measured against, and never frames a number as matching
or agreeing with a named party's released charts. Naming the source drags a third party
into the tool's marketing, and a "matches X" framing turns their work into a credential
(the exact failure mode charters distrust). This supersedes the earlier rule that named
the specific corpus in the how-it-works layer.

**What the page says instead:** describe the corpus by its nature and size, generically:
"officially authored charts", "charts that were synced by hand", "482 songs whose vocal
charts were synced by hand". The kind of source and the sample size are the facts a
reader needs; the identity is not. The named corpus stays in the research repo and its
result files, where the measurement is reproduced, not on the page or in the page's
provenance-tooltip strings. Script paths in provenance tooltips are quoted as they are.

A page under §3's established-category condition goes further: it states no training
provenance at all, generic or otherwise, and carries no measured numbers (Eli's
decision, 2026-08-19, for the difficulty pages). The rules in this section govern the
pages that do discuss provenance.

The rest is unchanged: the description is stated matter-of-factly, once, in a
how-it-works or fine-print layer. State the consent situation honestly if the page
discusses it, without self-congratulation and without arguing that precedent makes it
fine.

| Don't | Do |
|---|---|
| A hero chip reading "Learned from Harmonix" | Nothing, on a page under §3's established-category condition; otherwise a generic line in How it works: "The model was fit to charts that were synced by hand." |
| H1: "It reduces a chart the way Harmonix does" | H1 that names the tool's job: "Generate lower difficulties from an expert chart." |
| "Measured against 482 Harmonix-charted songs" | "Measured against 482 songs whose charts were synced by hand." |
| An accent color named after the training source | Accent colors named for their role in the design system. |
| "Trained on thousands of community charts" as a trust badge | State the kind of source and the count in How it works; do not use scale as a boast. |
| "We're proud to be transparent about our data" | State the data. Transparency is not a feature to congratulate yourself for. |

### 5.2 Comparisons to other tools

**Never editorialize that another tool is worse.** Present measurements in a table and stop.
No verdict sentence, no framing sentence that pre-chews the conclusion. The methodology goes
in a footnote so a reader can reproduce it. When a comparison's yardstick is the corpus a
model was trained on or measured against, §5.1 applies to that column too: describe it
generically ("the reference charts"), never by name.

Be generous. If another tool takes a more elegant approach, say so plainly and explain why
this one chose otherwise. Where another tool is the community standard and works well, say
that (Hop's difficulty tooling is broadly used and charters consider its quality sufficient;
that is a fact worth stating, not a competitor to undercut).

| Don't | Do |
|---|---|
| "The other tools strip far more notes than the reference charts do." | The table with the note-count column, plus a methodology footnote. |
| "By over-reducing, HOPCAT and Onyx land below the reference difficulty." | Same numbers in the same table, no sentence interpreting them. |
| "Unlike other tools, ours…" | Drop the clause. Describe what this tool does. |
| Omitting a comparison where the other tool wins | Include it. A table that only shows favorable rows is not a measurement. |
| Silence about a competitor's better design | "Onyx's approach avoids the separation step entirely, which is the cleaner path; this tool uses separation because it measured better on X." |

Never characterize another tool's authors, motives, or quality standards. Only its output,
only measured.

## 6. Numbers and claims

Numbers are welcome. Every number on a page must trace to a source: a script, an eval run,
or a documented measurement. Nothing invented, nothing approximated, nothing rounded into a
better-sounding figure.

Rules:

- When drafting, propose numbers as **sourced candidates** the owner can veto: give the
  claim, the number, and the script or eval path that produced it. Never ship a number the
  owner has not seen with its source.
- Unsourceable numbers are `⟨TBD⟩` in the draft, never a plausible-looking guess.
- Surface provenance in the UI where a number carries weight. The Stat chip pattern with a
  provenance tooltip (script path, measured-on date, provisional flag) is the house standard;
  reuse it rather than inventing a new affordance.
- Mark provisional numbers provisional, on the page, not just in the code.
- Percentages state their denominator and their test set size. "94%" alone is not a number.
- Do not convert a measurement into a superlative. "Highest accuracy" is not a measurement.
- Do not stack a measured number next to an unmeasured adjective so the adjective borrows
  its credibility.
- Time-savings claims ("cuts charting time in half") require a measurement of charting time.
  If there isn't one, the page does not make the claim.
- **Landing-page numbers must mean something to a charter.** ML metrics (macro F1, per-class
  scores) mean nothing to this audience and read as showing off; keep them in how-it-works.
  Prefer numbers a charter can feel: how many edits a draft needs, how that compares between
  tools they know, per-instrument breakdowns. A comparison table against known tools
  (presented per §5.2, no verdict sentence) beats an absolute metric with no referent.
- **Numbers go stale.** Landing copy must be drafted from the current results in the research
  repo (docs/paper_draft and the paper workstream state), never from an older page or branch.
  Re-verify every carried-over number on each revision.

| Don't | Do |
|---|---|
| "99% accurate lyric alignment" | "Syllable onsets landed within 100 ms of the reference on 99.8% of syllables (n = ⟨N⟩ songs, script: ⟨path⟩, measured 2026-04-07)." |
| "Massively faster than charting by hand" | Say nothing, or report a measured task time with its protocol. |
| "Trained on a huge dataset" | The actual count, with what it counted. |
| A stat with no tooltip and no date | Stat chip with script path, measured-on date, provisional flag when provisional. |

## 7. Trust signals checklist

Surface these prominently **where true**, in plain wording. Do not claim any of them where
they are not true, and do not soften a false one into a half-truth.

- [ ] **Local execution.** "Runs in your browser. Nothing is uploaded." Only if the whole
      pipeline is local. If any step calls a server, say which step and what it sends.
- [ ] **Determinism.** "The same input produces the same output." Only where true; if a
      step is nondeterministic (sampling, thread-dependent ordering), say so instead.
- [ ] **Inspectable before saving.** "You can open the result in the editor and check every
      note before saving." Name the actual review surface.
- [ ] **Download sizes stay off the landing page.** (Eli's decision, 2026-08-18, made
      while cutting them from the difficulty pages and /add-lyrics; those three pages
      follow it. /tempo and /drum-transcription still state "about 515 MB" in their
      trust lines and have not been revisited, so today this rule describes the newer
      pages, not the whole tree.) Model download sizes are not
      a landing-page trust fact, whatever the size. What the page still owes the reader is
      the model's existence — §3 requires saying a model runs — and the tool itself
      disclosing the download at the moment it starts one, with a visible size and
      progress, so the number is never a surprise mid-run.
- [ ] **What it writes and where.** If the tool modifies chart files, say what it touches.
- [ ] **Offline after first load**, where true.
- [ ] **Known failure modes**, specific and musical, near the capability claims. Not
      on a page under §3's established-category condition.
- [ ] **Not-one-shot statement** (§4), in the first screenful.

Trust signals are stated, not decorated. No badge graphics, no shield icons, no "100%
private" seals.

## 8. Per-page copy checklist

Before a tool page ships, confirm:

1. **Name and job.** The H1 says what the tool does, in the reader's vocabulary
   (charting terms, not product terms). No slogan H1.
2. **Not-one-shot statement** present, high, in body register (§4).
3. **Mechanism named** concretely (§3): model where a model, rules/table where rules.
4. **Failure modes** listed, specific, near the capability claims, unless the page is
   under §3's established-category condition.
5. **Trust signals** from §7 that are true for this tool, stated plainly.
6. **Numbers** all sourced, with provenance surfaced; provisional ones marked (§6).
7. **Provenance** of training data in the how-it-works layer, not the hero (§5.1);
   none at all, and no measured numbers, on a page under §3's established-category
   condition.
8. **Comparisons**, if any, are tables with a methodology footnote and no verdict sentence
   (§5.2).
9. **Banned phrases** swept (§9).
10. **Read it as a hostile charter.** Any sentence that would draw "yeah right" gets cut or
    replaced with a measurement.
11. **Cross-page consistency.** One canonical phrasing per concept across every page;
    if two pages describe the same mechanism differently, reconcile them.
12. **Every claim survives being screenshotted out of context.** Copy travels as screenshots
    in Discord. A qualifier three paragraphs away does not protect a claim.

## 9. Banned phrases and patterns

Phrases:

- "AI-powered", "powered by AI", "AI-driven", "AI-enhanced"
- "magic", "magical", "just works", "effortless", "seamless"
- "instantly perfect", "perfect results", "ready to play/upload" (about generated output)
- "revolutionary", "game-changing", "next-generation", "cutting-edge", "state-of-the-art"
  (unless it is a literal, sourced benchmark claim, in which case say the benchmark)
- "smart", "intelligent", "understands your music"
- "one click and you're done"
- "trusted by", "loved by", "join thousands of"
- "unlike other tools", "the only tool that"

Patterns:

- Superlatives without measurement ("best", "fastest", "most accurate").
- Em-dashes used as rhetorical pivots.
- "Not X, but Y" constructions.
- Meta-commentary about the page itself ("in this section", "let's dive in", "read on").
- Rhetorical-question headings.
- Verdict sentences attached to comparison tables.
- Training-data provenance used as a credential or hero element.
- Adjectives placed adjacent to a measured number so they inherit its authority.
- Hedges standing in for named failure modes ("results may vary", "your mileage may vary").
- Exclamation points.
- Emoji in body copy.

## Changelog

- 2026-08-19 (review reconciliation, difficulty pages): the difficulty pages carry no
  failure modes, no training provenance, and no measured numbers (Eli's decision): a
  tool in a category the community already trusts and uses does not have to argue its
  own limits the way a novel one does. Recorded as §3's established-category condition
  and threaded through §5.1, §7, and §8; /drum-transcription and /add-lyrics keep their
  failure modes. §7's download-size rule now states its actual scope: /tempo and
  /drum-transcription still show "about 515 MB" and have not been revisited. §5.2's
  example rows named the corpus the reduction model was measured against as the
  comparison yardstick; a yardstick that is the training or eval corpus now falls under
  §5.1 and is described generically.
- 2026-08-18 (feedback round 2, /add-lyrics): download sizes come off landing pages
  entirely — §7's disclosed-up-front item replaced with the opposite rule; the tool
  discloses the download when it starts one. Naming a published third-party model once
  as a plain credit line is wanted, not synonym rotation (§3 amended); the name still
  never carries the mechanism. Implementation details like vocals stems, caches, and
  rare fallback branches stay off the page: describe the ordinary case, once.
- 2026-08-18 (difficulty-pages feedback rounds, applied to /add-lyrics): illustration
  captions describe the effect the reader should take away, never restate what the
  picture depicts (/drum-transcription's hero caption is the model); landing copy never
  names the corpus a model was trained on or measured against and never frames a number
  as matching a named party's charts — describe the source generically with its size
  (§5.1 rewritten; it previously said to name the source in how-it-works); one canonical
  phrasing per mechanism, "a trained model" or its job-specific form, no synonym
  rotation; only assert a burden the reader actually feels, once, in the lede.
- 2026-08-06 (feedback round 3, /drum-transcription): hero lede sells the purpose (speed
  up charting, first pass, you fix what's wrong), never a mechanism enumeration; every
  noun needs an established referent ("the draft" standing alone is banned); landing pages
  get the regular site header, not the compact editor chrome; don't reference an unshipped
  page (the how-it-works teaser left the page until that page ships).
- 2026-08-06 (feedback round 2, /drum-transcription): no structural numbering on landing
  sections (they are not a sequence); per-instrument comparison table preferred over
  separate per-system tables, all systems measured on the same eval set; corpus size can
  appear inline in the how-it-works teaser rather than as its own paragraph; don't mention
  capabilities outside the page's instrument scope (no lyrics on the drum page); "review
  and edit notes", never "edit every note" (not every note needs modification).
- 2026-08-06 (feedback round 1, /drum-transcription): reader is not ML-technical — no
  architecture jargon in landing copy (say "a custom trained transcription model", not
  "CRNN"); landing numbers must mean something to a charter (edit rates and tool
  comparisons, not macro F1); numbers must be re-verified against the current research
  state on every revision, never carried from older pages or branches.
- 2026-08-06: Created. Sources: the drum-to-chart paper style guide (voice, humility,
  numbers-trace-to-source, generosity to alternatives, release-ethics framing), the AI
  charting ethos note, and Eli's decisions on the first landing-page draft (neutral tool
  voice, precise technology labeling, required not-one-shot statement, provenance demoted
  out of the hero, comparison tables without verdicts, trust-signal checklist).
