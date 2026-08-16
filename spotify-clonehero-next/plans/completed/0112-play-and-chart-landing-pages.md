# 0112 — The player home page and the charter page

Status: complete

The home page is a card grid that lists every tool at equal weight. It has to
serve two audiences that want different things, and it does neither well: a
player wants songs, a charter wants to know what the tools do to a chart and
what is left for them to fix.

This plan replaces the home page with the player page and adds the charter
page beside it. The two were built as `/play` and `/chart` first and reviewed
in the browser; `/play` then became `/`, its component moving to
`app/landing/PlayerLanding.tsx`, and the card grid was deleted.

## The two pages

**`/`** — the player page. Two offerings, because there are exactly two
player tools: charts matched against a Spotify or Apple Music library
(`/find-music`), and drum charts rendered as sheet music (`/sheet-music`). It
closes with the doorway to the other page: _Want the song you're looking for to
exist? Chart it yourself._

**`/chart`** — the charter page, built as the sequence a chart moves through.
One band per step, each naming the tool that does the repetitive part of that
step and showing what that step produces. `/why` is linked twice from inside
the page, under the hero and at the close, rather than sitting in the nav.

Both are position pages in the landing shell: `LandingPage` + `LandingHero`,
no `ToolEntrySection` and so no `ScrollToStartCta` (it would scroll to an id
that never rendered).

## What this needs that the shell does not have

The pages are built from alternating two-column rows — copy on one side, a
picture of the step's output on the other. `LandingSection` is single-column by
construction, so this adds one primitive:

`components/landing/FeatureBand.tsx` — an `h2`, body copy, optional actions,
and an illustration slot, in a two-column grid that stacks on small screens
and can flip sides. Six users across the two pages, which is past the
extract-on-the-second-user line.

## Illustrations

Each band shows what its step produces. The two model-backed steps reuse the
canvases from the tools' own landing heroes rather than drawing a second
picture of the same thing:

| band            | illustration                                                |
| --------------- | ----------------------------------------------------------- |
| Find Music      | the three sources, using the app's own Spotify and Apple Music marks |
| Sheet music     | one bar of drum notation as `/sheet-music` renders it        |
| Tempo           | `BeatGridCanvas`, from the `/tempo` hero                     |
| Drum notes      | `EditPassCanvas`, from the `/drum-transcription` hero        |
| Difficulties    | one bar thinned for Expert, Hard, Medium, Easy               |
| Lyrics          | syllables with their timestamps                              |
| Packaging       | a package unpacked and repacked                              |

The canvases are imported across route directories (`@/app/tempo/landing/…`),
which this repo already does elsewhere (`/tempo` imports `AudioUploader` from
`/drum-transcription`). They stay owned by their tool pages; nothing moves.

The Spotify and Apple Music marks are the official artwork the app already
ships — `Icons.spotify` and `AppleMusicIcon` — so brand usage is decided in one
place rather than redrawn per page.

Spotify's [design guidelines](https://developer.spotify.com/documentation/design)
set three rules the first draft broke: the icon has a 21px floor, it wants
clear space of half its own height around it, and the green icon may sit only
on a black or a white background. The first draft drew it at 20px inside a
green tile of our own. It is now 32px, in Spotify green, directly on `bg-card`
(near-black in dark, white in light), with 16px of padding and gap around it.
The Apple Music tile is the shipped artwork at the same 32px, unmodified.

## Copy decisions this plan makes

- **No model download sizes on `/chart`.** They belong to the tool pages that
  own those models. Repeating them is a second number to keep true and a cost
  quoted before the reader has decided to care.
- **The transcription step says it is drums only.** A guitar chart does not get
  proposed notes, and a page shaped like a sequence must not imply it does.
- **The closing section is about drafts, not a defect list.** It uses the
  register `/tempo` and `/drum-transcription` already use — some songs come out
  clean and some don't, the draft saves the hours that were never musical. The
  per-tool failure modes stay on the tool pages, where they are specific.
- **The SNG File Manager is its own step.** Packaging is not lyrics work, and
  pairing them in one band was wrong.
- **Difficulty generation has been automated for years.** The page says that
  plainly and does not claim any ordering of who did it first.

## Nav

`SiteNav` carries **Play** and **Chart**. Play and the brand link go to the
same place, and it is listed anyway: a wordmark is not a nav item, and a reader
inside `/chart` needs a way back that says what it is. **More Tools** is gone
from both headers — it pointed at the card grid, which no longer exists. The
compact editor header keeps only the standing set (brand link home, socials,
auth); 40px above an editor is not the place for audience links.

## What else moved with the front door

- **`/why`'s footer** said "See all the tools" and linked `/`. There is no
  all-tools page now, so it links `/chart` and says so.
- **The home page's `SupportedBrowserWarning`** is gone. It belongs on the
  tools that need the APIs it checks, and `/find-music` already renders its
  own; a marketing page warning about File System Access before the reader has
  asked for anything was noise.
- **`/chart` gets its own OG card** (`app/chart/opengraph-image.tsx`): the four
  stages, left to right, in lane colors. The root card stays generic because it
  is still the default for every route without one.
- **A `LandingFooter`** keeps the old card grid's small right-aligned Privacy
  link on both pages. Losing it would have dropped the only route to the
  privacy policy from the front door.

## Out of scope

- Moving the measurement tables onto `/chart`. If they belong there they must
  render the same metrics modules, not a copy.
- `/karaoke`, which is on neither page.
- The root OG card's "Find · View · Lyrics" row, which now under-describes the
  site but is shared by every route that has no card of its own.
