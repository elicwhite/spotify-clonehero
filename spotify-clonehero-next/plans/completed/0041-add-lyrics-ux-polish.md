# Plan 0041: Add-lyrics UX polish

> **Scope:** UX-only. Functional pipeline (Demucs, syllabifier, aligner, exporter) is unchanged.
> **Pages touched:** `app/add-lyrics/page.tsx`, drop-zone styling, chart-editor first-run hint.
> **Constraints:** Light + dark must both look good; no dark-only colors. No new state libraries.

## Context

`/add-lyrics` is functionally complete: drop a chart, paste lyrics, watch a 4-step pipeline run, land in the chart-editor with a vocals highway and a Download button. End-to-end exploration in chrome-devtools (light + dark) surfaced UX issues at every step:

1. **Landing.** Hero has emoji-icons (`📁 ✏️ 🎵 📥`) that look unfinished next to the rest of the app's lucide-icons. The "Or select a chart folder" button is full-width and equal weight to the drop zone, even though folder-picker is a fallback path with weaker browser support.

2. **Chart-loaded / paste view.** The full ChartDropZone is rendered _again_ below the loaded-chart header — a second drop area + folder-picker button — taking ~120px of vertical space the user no longer needs. The "this chart already has lyrics" warning uses `text-yellow-200` on `bg-yellow-500/10`, which is fine in dark mode but **unreadable in light mode**. The textarea has no formatting hints; users don't know whether `[Chorus]` headers, `(backing vocals)` parentheses, or blank lines matter, so they get nervous.

3. **Processing.** Adequate but stark. Loses chart context (no song name once you click Align). The active step shows no progress bar or time-remaining for Demucs even though the worker already computes both — the step-list just shows a spinner for ~30 s. The `text-yellow-200` text-color in step-detail also has the same light-mode contrast bug if any step ever produces yellow text.

4. **Post-alignment editor.** The user lands in the highway with a completed download button — no indication that they can fix bad alignments by dragging lyric markers. The whole "drag to manually align" feature is invisible to a first-time user.

Plus — light vs dark: the page mostly uses tokenized colors (`bg-muted`, `text-muted-foreground`, `border-border`) that adapt cleanly. The two regressions are both yellow-on-yellow warning treatments. Everything else works in both modes once those are fixed.

## Goal

A landing → paste → processing → editor flow that:

1. Looks intentional in both light and dark modes (no token-violating colors).
2. Tells a first-time user the two things they don't currently know:
   - what formats / shapes of lyrics work,
   - that they can drag any aligned lyric marker on the highway to fix it before downloading.
3. Stops repeating the chart picker once a chart is loaded.

## Non-goals

- **No copy rewrite of pipeline step labels.** "Decoding audio" / "Separating vocal stem" / "Splitting lyrics into syllables" / "Aligning syllables to audio" are accurate and stay.
- **No new icon library.** Use `lucide-react` (already a dep) for the flow diagram.
- **No demo-song button.** A "try with our sample" button is tempting but pulls in licensing questions; out of scope.
- **No persisted "don't show again" for the drag hint** beyond `localStorage`. Plan 0037+ may introduce a real onboarding store; for now a single localStorage key is enough.
- **No theme toggle.** The app honors `prefers-color-scheme` system-wide (`app/globals.css`); we keep that contract.

## Design

### 1. Landing page (`status === 'idle'`)

`app/add-lyrics/page.tsx` lines 754–773 + `FlowStep`/`FlowArrow` (lines 873–900).

**Replace emoji icons with lucide icons** that match the existing app's visual language:

| Step     | Icon (lucide)    |
| -------- | ---------------- |
| Open     | `FolderOpen`     |
| Paste    | `ClipboardPaste` |
| Align    | `AudioWaveform`  |
| Download | `Download`       |

Render each as `<Icon className="h-6 w-6 text-muted-foreground" />` inside a circular `bg-background` chip — gives the diagram structure in both modes without a flat-emoji feel.

**Demote the folder picker.** `ChartDropZone` already groups dropzone + folder-picker as full-width siblings. For add-lyrics, pass a new optional prop `folderPickerVariant?: 'button' | 'link'` (default `'button'` — preserves existing chart-review/drum-edit usage). Add-lyrics passes `'link'`, which renders the picker as a small text link beneath the dropzone (`<button class="text-xs text-muted-foreground underline">Or select a chart folder</button>`). Reduces visual weight by ~70%.

### 2. Chart-loaded / paste view (`status === 'input'`)

`app/add-lyrics/page.tsx` lines 784–858.

**Collapse the duplicate drop zone.** After a chart is loaded, the user does not need a full drop area + folder-picker button. Replace the entire right-column `<ChartDropZone>` (lines 813–816) with a single small `Choose New Chart` button (`<Button variant="ghost" size="sm">`) that opens a hidden `<input type="file" accept=".zip,.sng">`. Keeping the same `handleChartLoaded` callback wiring; no logic change. Frees ~90px of vertical space and stops the "did my upload work?" confusion of seeing the dropzone unchanged after upload.

**Fix the yellow-warning contrast.** The "This chart already has lyrics" alert at lines 820–833 currently uses `text-yellow-200` on `bg-yellow-500/10` — fine in dark, unreadable in light. The project doesn't ship `components/ui/alert.tsx` (only `alert-dialog.tsx`), so don't introduce a new shadcn primitive for one warning. Inline the paired classes directly:

```tsx
<div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 flex items-start gap-3">
  <TriangleAlert className="h-4 w-4 mt-0.5 text-yellow-700 dark:text-yellow-300 shrink-0" />
  <div className="flex-1">
    <p className="text-sm text-yellow-800 dark:text-yellow-200">
      This chart already has lyrics. Aligning will replace them.
    </p>
    <Button
      variant="outline"
      size="sm"
      className="mt-2"
      onClick={() => setShowLyricsWarning(false)}>
      OK, continue
    </Button>
  </div>
</div>
```

`text-yellow-800` / `text-yellow-200` is the standard tailwind warning-text pairing and clears WCAG AA in both modes. If this pattern recurs elsewhere, factor it into an `Alert` primitive then.

**Add lyric-format guidance.** Above the textarea (lines 836–847), render a static one-liner:

```
Tips: paste plain lyrics, one line per phrase. All pasted text becomes lyrics, so don't include non-lyric
symbols or section headers like [Verse]. One line per phrase.
```

Style: `text-xs text-muted-foreground` directly above the label. Cheaper than a popover, and warns about the right thing.

**Make the Align button more prominent.** Currently `<Button size="lg">`. Stay at lg but add `className="w-full sm:w-auto"` and align-it as a clear single primary action below the textarea. The button reads as "the next step" rather than "a control somewhere on the page." No pre-execution time estimate next to it — alignment speed varies a lot by hardware (Demucs is GPU-bound) and a misleading static estimate is worse than none.

### 3. Shared `ProcessingView` (replaces both add-lyrics' `ProgressCard` and drum-transcription's `ProcessingView`)

The two pages have parallel implementations of the same UI: a card with a step list, per-step status icon, optional dynamic detail line, optional inner progress bar. Drum-transcription has the cleaner skeleton (shadcn `Card` + `Progress`, lucide icons, error/retry path). Add-lyrics has more useful per-step metadata (elapsed `1.4s` suffix once done, dynamic `detail` line). Merge to a single shared component, refactor both consumers.

#### Location & API

New file: `components/ProcessingView.tsx`. Replaces `app/drum-transcription/components/ProcessingView.tsx` (delete) and add-lyrics' inline `ProgressCard` (delete lines 906–1008 of `page.tsx`).

```ts
export interface ProcessingStep {
  /** Stable id used as React key; not displayed. */
  key: string;
  /** Bold first line, e.g. "Separating vocal stem". */
  label: string;
  /** Optional muted second line, e.g. "Running Demucs (~161 MB model)". */
  description?: string;
  status: 'pending' | 'active' | 'done' | 'error';
  /** 0..1 progress within this step. If omitted on an active step,
   *  the inner bar renders as indeterminate. */
  progress?: number;
  /** Seconds remaining for the active step. Renders only when
   *  status==='active' && progress > 0.05 && etaSeconds > 5.
   *  Below those thresholds the estimate is too noisy to show. */
  etaSeconds?: number;
  /** Wall-clock duration once status==='done'. Rendered as " 1.4s ".  */
  durationMs?: number;
  /** Dynamic detail line ("Separating segment 5/34"). Optional. */
  detail?: string;
}

export interface ProcessingViewProps {
  title: string; // "Processing" or "Adding lyrics to your chart"
  subtitle?: string; // song title, etc.
  description?: string; // small caption under title
  steps: ProcessingStep[];
  error?: string | null;
  onRetry?: () => void;
  onCancel?: () => void;
}
```

The component intentionally does **not** compute or display an overall ETA across steps — per the requirement, that math is brittle when steps are weighted differently. Each step shows its own ETA when it has one.

#### Visual layout (light + dark via tokenized colors only)

```
┌─────────────────────────────────────────────────────────┐
│  Adding lyrics to your chart                            │
│  SUCKERPUNCH — All Time Low                             │
│                                                         │
│  ✅  Decoding audio                            1.4s     │
│      172.8s, 2ch, 44100Hz                              │
│                                                         │
│  ⟳   Separating vocal stem                              │
│      Separating segment 12/34   · 22s left              │
│      ████████░░░░░░░░░░░░░░░░░░░░░░░░░░  35 %           │
│                                                         │
│  ○   Splitting lyrics into syllables                    │
│  ○   Aligning syllables to audio                        │
└─────────────────────────────────────────────────────────┘
```

Implementation notes:

- Reuses `Card` / `CardHeader` / `CardContent` from `components/ui/card.tsx`.
- Reuses `Progress` from `components/ui/progress.tsx` for the inner bar (height `h-1.5`).
- Status icons: `CheckCircle2` (green-500 — already used in drum-transcription's view, OK for both modes), `Loader2 animate-spin` (text-primary), `Circle` (muted-foreground/40), `AlertCircle` (destructive). All from `lucide-react`.
- Error state renders the AlertCircle + the error message + Retry/Back buttons (lifted verbatim from drum-transcription's error card).
- Indeterminate progress: when `status==='active'` and `progress` is undefined, render the inner bar with the existing shadcn pattern of `value={null}` / pulse animation.
- Light/dark: every color is tokenized (`text-muted-foreground`, `bg-muted`, `text-primary`, `text-destructive`) except `text-green-500` for the success check. Audit confirms `text-green-500` looks correct in both modes (drum-transcription already ships it).

#### ETA computation

There are two sources of progress data; the component only consumes the merged shape, but the page-side adapters need to compute `etaSeconds`:

- **Source-provided ETA** is preferred when the worker already does the math. Demucs in `lib/lyrics-align/demucs-worker.ts:147–151` already runs an exponential moving average of segment durations. Today it serializes the result into a string (`": 25 seconds remaining"`); change the worker contract to also send a structured field so the page doesn't re-parse strings.
- **Generic fallback** for steps that report only `progress`. Compute in the page adapter as `etaSeconds = elapsedSec * (1 - p) / p` once `p > 0.05`. Smooth with a single-pole low-pass to avoid jitter (`smoothed = 0.7 * smoothed + 0.3 * raw`).

Display rules live in the component, not the adapters:

- Hide ETA if `status !== 'active'`.
- Hide if `progress === undefined || progress < 0.05` (too early; the estimate is noise).
- Hide if `etaSeconds < 5` (granular seconds-countdown is more annoying than helpful at the tail).
- Format: `< 60s` → `"22s left"`; `>= 60s` → `"1m 20s left"`.

#### Add-lyrics adapter changes

`app/add-lyrics/page.tsx`:

- Delete `interface PipelineStep`, `ALIGN_STEPS`, `ProgressCard` (lines 55–84, 906–1008).
- Replace local `alignSteps` state with the new `ProcessingStep[]` shape.
- Lift the chart-info header (currently lines 787–817 only shown for `status === 'input'`) to render during both `input` and `processing`, so the song title stays visible. Pass it as `subtitle` to `<ProcessingView>`.
- Do not pass a `description` with a pre-execution time estimate. Speed varies dramatically across hardware (CPU vs WebGPU, M-series vs older Intel) and any static "~N minutes" claim will mislead at least half the audience. The per-step ETA computed live from worker timing handles "how long is this taking?" honestly.

`lib/lyrics-align/demucs-worker.ts`:

- Change the progress message contract from a single string to `{type: 'progress', currentSegment, totalSegments, etaSeconds, label}`. Keep `label` for the optional `detail` line ("Separating segment 12/34"). Backward-compat shim for any other consumer not needed — the only consumer is `runDemucsInWorker`.

`lib/lyrics-align/demucs-client.ts` (`runDemucsInWorker`):

- Change the `msg` callback signature from `(msg: string) => void` to `(progress: {percent: number; etaSeconds?: number; detail: string}) => void`. The page's `updateAlignStep` becomes:

  ```ts
  vocals16k = await runDemucsInWorker(audioBuffer, p =>
    updateAlignStep('separate', {
      detail: p.detail,
      progress: p.percent,
      etaSeconds: p.etaSeconds,
    }),
  );
  ```

The aligner step renders as indeterminate (spinner, no inner bar, no ETA) — by design, not by oversight:

- The CTC pass is a single ONNX `session.run(...)` over the full song. `aligner-worker.ts:226–238` explicitly forbids chunking it; the author's comment notes that 30 s chunked emissions drift ~30–40 ms vs single-pass, which silently breaks the exp23 autoresearch calibration. Adding artificial chunking just to populate a progress bar would degrade alignment quality.
- The Viterbi step is a single synchronous DP pass with no natural yield points.
- For a typical 3-minute song the full alignment step is ~5–15 s wall-time on WebGPU; an indeterminate spinner reads honestly.

There is one sub-case where ETA _is_ possible: the chunked fallback in `getEmissions` (`aligner-worker.ts:258–269`) — kicks in only when WebGPU OOMs on long songs (~6 min+). It iterates `chunk i/numChunks` and could surface an EMA ETA the same way Demucs does. **Out of scope for this plan** because (a) it's a rare branch and (b) wiring requires reshaping the worker outbound message contract for a path most users will never hit. Capture as a follow-up if anyone reports the long-song flow feels stuck.

#### Drum-transcription adapter changes

`app/drum-transcription/page.tsx`:

- Replace `import ProcessingView from './components/ProcessingView'` with `import ProcessingView from '@/components/ProcessingView'`.
- Add a `pipelineProgressToSteps(progress: PipelineProgress, stepStartTimes: Map<...>): ProcessingStep[]` helper that maps the existing 4-step enum to the shared shape. Track step-start timestamps in a `useRef<Map<PipelineStep, number>>` to compute `durationMs` on completion and `etaSeconds` on the active step. The `<ProcessingView>` call site stays roughly the same shape.

`lib/drum-transcription/ml/demucs.ts`:

- `SeparationProgress` already carries `segment` / `totalSegments` / `percent`. Add an optional `etaSeconds?: number` field. Compute it in `lib/drum-transcription/ml/demucs-worker.ts` (same EMA pattern Demucs in lyrics-align already uses) and surface it through `runDemucsInWorker`.

`lib/drum-transcription/ml/transcriber.ts`:

- Already reports `{step, percent}` only. No ETA source available; the page adapter falls back to `elapsed * (1-p)/p`.

#### Test surface

Light unit test for the ETA-from-elapsed math + the smoothing — pure function, no React. Skip Jest snapshot tests of the rendered component; the visual check is the chrome-devtools screenshot pass at the end of plan validation.

### 4. Post-alignment editor: drag-to-realign hint

`app/add-lyrics/page.tsx` lines 674–739 (the `showEditor` branch).

This is the "popup explaining you can manually align by dragging" the user asked for. Implemented as a centered modal — toasts auto-dismiss and slide in from a corner, which buries information the user genuinely needs the first time they land in the editor.

**A one-time modal on first entry to the editor.** Use the existing shadcn `Dialog` (`components/ui/dialog.tsx` — already in the project; built on Radix). Open it once per browser, gated by `localStorage`:

```tsx
const [showIntro, setShowIntro] = useState(false);

useEffect(() => {
  if (!editorData) return;
  const KEY = 'add-lyrics:editor-intro-shown-v1';
  if (localStorage.getItem(KEY)) return;
  setShowIntro(true);
  localStorage.setItem(KEY, '1');
}, [editorData]);

<Dialog open={showIntro} onOpenChange={setShowIntro}>
  <DialogContent className="sm:max-w-md">
    <DialogHeader>
      <DialogTitle>Your lyrics are aligned</DialogTitle>
      <DialogDescription>
        A few things worth knowing before you fine-tune.
      </DialogDescription>
    </DialogHeader>
    <ul className="space-y-3 text-sm">
      <li className="flex items-start gap-3">
        <Move className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <span>
          <strong>Drag any lyric</strong> on the highway to nudge its timing.
          Useful when the aligner picked the wrong onset.
        </span>
      </li>
      <li className="flex items-start gap-3">
        <AudioWaveform className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <span>
          The waveform on the highway is the{' '}
          <strong>isolated vocal stem</strong>, not the full song mix — easier
          to spot where each line should sit.
        </span>
      </li>
      <li className="flex items-start gap-3">
        <Download className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <span>
          When the timing looks right, hit <strong>Download</strong>
          in the top-right to get the updated chart.
        </span>
      </li>
    </ul>
    <DialogFooter>
      <Button onClick={() => setShowIntro(false)}>Got it</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>;
```

Lucide icons (`Move`, `AudioWaveform`, `Download`) ride `text-muted-foreground` so the modal works in both light and dark. The Dialog primitive already handles overlay, focus trap, escape-to-close, and inert-background — no extra wiring.

Versioned key (`editor-intro-shown-v1`); bump to `v2` if the modal copy ever changes substantively so returning users see the new content once.

**A persistent visual cue** for after-the-modal-is-dismissed — a small inline label in the editor header next to "Re-align":

```tsx
<span className="text-xs text-muted-foreground hidden sm:inline">
  Drag any lyric to fix its timing
</span>
```

The modal handles "read it once;" the header label handles "remember six minutes later." Adapts to light/dark via `text-muted-foreground`.

**Re-align doesn't re-trigger the modal.** When the user clicks Re-align (line 696) we tear down `editorData` and they re-enter the editor branch with a new instance — the effect would re-fire if we keyed off `editorData` alone. The `localStorage` key prevents it; intentional, since the user has already seen the intro this session.

### 5. Page metadata for link previews (Discord, Slack, Bluesky, etc.)

When someone pastes a tool URL into Discord, the unfurl card today shows the root layout's `Music Charts Tools` title — nothing else, no description, no thumbnail. Three problems compound:

1. **Root layout** (`app/layout.tsx`) sets only `title` + `description`. No `metadataBase`, no `openGraph`, no `twitter` blocks, no site-wide OG image. Without `metadataBase` Next.js can't resolve relative image URLs into absolute ones, which Discord requires.
2. **Tool pages are `'use client'`** (`add-lyrics`, `drum-transcription`, `drum-edit`, `chart-review`). `export const metadata` is silently ignored in client components — none of those routes contribute metadata at all.
3. **No OG image asset.** Even the working `app/karaoke/[slug]/page.tsx` only gets a thumbnail because each chart has an album-art URL; routes without song-specific art have no fallback.

#### Site-wide setup (`app/layout.tsx`)

```ts
export const metadata: Metadata = {
  metadataBase: new URL('https://music-charts-tools.example'), // exact domain TBD — see note
  title: {
    default: 'Music Charts Tools',
    template: '%s · Music Charts Tools',
  },
  description:
    'Browser-based tools for Clone Hero charts: drum transcription, lyric alignment, sheet music, and more.',
  openGraph: {
    type: 'website',
    siteName: 'Music Charts Tools',
    images: ['/og-default.png'],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/og-default.png'],
  },
};
```

Per-page `title: 'Add lyrics to a chart'` then renders as `Add lyrics to a chart · Music Charts Tools` thanks to the template. `metadataBase` upgrades `/og-default.png` to an absolute URL automatically.

`metadataBase` URL: confirm production domain with the user before merging — likely the deployed Vercel URL or a custom domain. Wrong domain == broken images in production previews even though dev previews look fine.

#### Default OG image

Ship `public/og-default.png` at 1200×630 (Twitter `summary_large_image` requires this aspect). Any branded image works — text "Music Charts Tools" over a Clone Hero highway-style background is on-brand and matches the app. Punt the asset itself to the user; the plan only specifies the path and dimensions.

#### Convert client pages to server-pages-with-client-children

For each `'use client'` page that owns a route the user might share, do the rename-and-wrap dance:

```
# Before
app/add-lyrics/page.tsx          (client, useState/useEffect/etc.)

# After
app/add-lyrics/page.tsx          (server, exports metadata, renders <AddLyricsClient/>)
app/add-lyrics/AddLyricsClient.tsx  (client, all the existing code)
```

The server `page.tsx` looks like:

```tsx
import type {Metadata} from 'next';
import AddLyricsClient from './AddLyricsClient';

export const metadata: Metadata = {
  title: 'Add lyrics to a chart',
  description:
    'Add timed, syllable-level lyrics to any Clone Hero chart. Runs entirely in your browser.',
  openGraph: {
    title: 'Add lyrics to a chart',
    description:
      'Add timed, syllable-level lyrics to any Clone Hero chart. Runs entirely in your browser.',
  },
  twitter: {
    title: 'Add lyrics to a chart',
    description:
      'Add timed, syllable-level lyrics to any Clone Hero chart. Runs entirely in your browser.',
  },
};

export default function Page() {
  return <AddLyricsClient />;
}
```

The `openGraph`/`twitter` blocks inherit `images`, `siteName`, etc. from the root layout — only `title` + `description` need per-page overrides.

#### Routes to cover

This plan only touches the routes shipped in 0041's scope; other tool pages get the same treatment in a follow-up if desired:

| Route                 | Title                            | One-line description                                                                                |
| --------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `/` (home)            | (default — `Music Charts Tools`) | (default)                                                                                           |
| `/add-lyrics`         | Add lyrics to a chart            | Add timed, syllable-level lyrics to any Clone Hero chart. Runs entirely in your browser.            |
| `/drum-transcription` | Transcribe drums from audio      | Upload a song, get a Clone Hero drum chart. AI stem-separation + transcription, all in the browser. |
| `/drum-edit`          | Edit a drum chart                | Browser-based drum chart editor for Clone Hero — like Moonscraper, no install.                      |
| `/chart-review`       | Review drum charts               | Batch-review drum chart quality with a preloaded highway preview.                                   |

Out of scope (covered separately or already done): `/karaoke/[slug]` (already has per-chart metadata), `/sheet-music`, `/spotify`, `/spotifyhistory`, `/account`, `/auth/*`.

#### Validation

```
yarn build && yarn start   # production build needed for metadataBase to resolve
# In a separate terminal:
curl -s http://localhost:3000/add-lyrics | grep -E "og:|twitter:|<title>"
```

Should show:

- `<title>Add lyrics to a chart · Music Charts Tools</title>`
- `<meta property="og:title" content="Add lyrics to a chart">`
- `<meta property="og:image" content="https://.../og-default.png">` (absolute URL — confirms `metadataBase` works)
- `<meta name="twitter:card" content="summary_large_image">`

Then drop the URL into Discord's link-unfurl debugger (paste into a private channel; Discord re-fetches once per ~hour). Twitter has https://cards-dev.twitter.com/validator. Slack: https://api.slack.com/reference/messaging/link-unfurling has a tester.

### 6. Light/dark audit

Concrete grep targets — every match must use a tokenized color or a `dark:` variant:

```bash
rg "text-yellow|bg-yellow|text-red-|bg-red-|text-green-|bg-green-" app/add-lyrics/
rg "text-white|bg-white|text-black|bg-black" app/add-lyrics/
```

Expected: only `text-yellow-700 dark:text-yellow-200` (the warning) and similar paired classes survive. Anything else gets replaced with a CSS variable or tokenized utility.

The `border-b-2 border-foreground` spinner (lines 778, 732) already adapts — keep.

## Implementation order (small atomic commits)

1. **Light/dark warning fix** (smallest, isolated). Inline yellow paired classes; verifies in both modes.
2. **Extract shared `ProcessingView`.** Move `app/drum-transcription/components/ProcessingView.tsx` → `components/ProcessingView.tsx`, add the new `ProcessingStep` shape, ETA/duration formatting, indeterminate-bar fallback. Migrate drum-transcription's caller. No behavior change for that page.
3. **Add structured ETA to Demucs workers.** `lib/drum-transcription/ml/demucs.ts` + `lib/lyrics-align/demucs-worker.ts`: surface `etaSeconds` from the existing EMA. Update the two `runDemucsInWorker` callers' progress callback signatures.
4. **Migrate add-lyrics' `ProgressCard` to shared `ProcessingView`.** Delete the inline component; lift the chart-info header so the song name shows during processing.
5. **Lucide flow diagram + folder-picker demotion.** Adds `folderPickerVariant` prop to `ChartDropZone`, swaps emoji for icons.
6. **Collapse duplicate dropzone in input view.** "Replace chart" button.
7. **Lyric tips + Align prominence.** Pure markup additions to the input view.
8. **Post-alignment intro modal + header hint.** shadcn `Dialog`, localStorage key, header label.
9. **Page metadata for link previews.** Set `metadataBase` + site-wide OG/Twitter blocks in `app/layout.tsx`; ship `public/og-default.png`; convert each `'use client'` tool page (`add-lyrics`, `drum-transcription`, `drum-edit`, `chart-review`) into a server `page.tsx` + sibling client component so per-route `metadata` exports work.
10. **Final light/dark sweep.** Run the rg from §6, fix any leftover hardcoded colors, screenshot all states in both modes.

Each commit ships independently — none requires the next, except 4 which depends on 2 and 3.

## Validation

For every step:

```
yarn dev
# In chrome-devtools MCP:
# 1. navigate /add-lyrics
# 2. emulate colorScheme=light → screenshot
# 3. emulate colorScheme=dark → screenshot
# 4. for steps 3-6: upload public/All Time Low - SUCKERPUNCH (Hubbubble).sng,
#    fill lyrics, click Align, capture each state in both modes
```

Capture: landing, paste-view (with + without warning), processing, post-alignment editor (modal open + dismissed) — ten screenshots per change set, five per mode. Eyeball contrast; verify the intro modal fires once per browser (clear `localStorage` between runs).

## Risks

- **`ChartDropZone` API change** is consumed by `add-lyrics` and at least drum-edit / chart-review. Adding an optional prop with a default keeps existing call sites compiling unchanged.
- **Demucs worker contract change.** Both pipelines have one consumer each. The change is mechanical (string → object). Catch in TS at build time.
- **Drum-transcription regression risk.** Step 2 of the implementation order migrates drum-transcription's working ProcessingView before add-lyrics is ready. Mitigated because step 2 is a pure refactor — same visual output, same call signature shape — and we screenshot both pages in both modes after each commit.
- **Modal frequency** — versioned localStorage key; if we change the modal copy substantively, bump `v1` → `v2` so returning users see the new content once.
- **Production domain in `metadataBase`** — using a wrong/dev URL means link previews look fine in `yarn dev` but ship broken absolute image URLs to Discord. Confirm the deployed domain with the user before merging step 9.
- **Client → server page split.** Each `'use client'` page move is a small refactor — the client file inherits all hook state and props unchanged; only the file path changes. Verify by smoke-testing each route after the rename.
