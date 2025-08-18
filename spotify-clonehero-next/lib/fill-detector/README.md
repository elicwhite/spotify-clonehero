---

## **Design Document — Drum-Fill Extractor (JavaScript / TypeScript)**

**Goal:** Scan a `ParsedChart` drum track, locate every section that functions as a *drum fill*, and return an **in-memory JavaScript object** containing the time bounds and heuristic scores for each detected fill.
**Scope:** Chart-only (no audio, no section names). Works song-by-song; a batch-runner can simply iterate.

---

### 1 · Functional Requirements

| ID  | Requirement                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------- |
| F-1 | Accept a fully-resolved `ParsedChart` object (see §A) and a config object (optional).                                         |
| F-2 | Analyse **one drum difficulty level** (default: `"expert"`).                                                                  |
| F-3 | Detect candidate fills using _chart-agnostic_ heuristics: density spike, voice-share change, groove-distance outlier, etc.    |
| F-4 | For every merged fill segment return: start/end **tick**, start/end **ms**, and a score for each heuristic (raw or z-scored). |
| F-5 | API returns `FillSegment[]` (see §B). No disk output required.                                                                |
| F-6 | All thresholds / window sizes editable via a JSON config; sensible defaults provided.                                         |
| F-7 | Deterministic: same inputs + config ⇒ identical output.                                                                       |

---

### 2 · Non-Functional Requirements

| Concern       | Target                                        |
| ------------- | --------------------------------------------- |
| Language      | Node.js ≥ 20, **TypeScript 5** (strict mode). |
| Performance   | ≤ 100 ms per 5-min song on M2 single thread.  |
| Memory        | ≤ 50 MB / song.                               |
| Reliability   | ≥ 95 % charts processed without exception.    |
| Test coverage | ≥ 80 % (Jest).                                |
| Style         | ESLint + Prettier + Typedoc comments.         |

---

### 3 · Domain Model & Type Definitions

#### A. **Input Types** (excerpt — already provided)

```ts
interface NoteEvent {
  tick: number;
  msTime: number;
  length: number;
  msLength: number;
  type: NoteType;   // e.g. 0-5 for drum lanes, authoring dependent
  flags: number;
}

type ParsedChart = {
  resolution: number;                // ticks per quarter note
  tempos: { tick: number; bpm: number; msTime: number }[];
  trackData: {
    instrument: "drums" | /* … */;
    difficulty: "expert" | "hard" | "medium" | "easy";
    noteEventGroups: (NoteEvent & { msTime: number; msLength: number })[][];
  }[];
  /* other fields omitted */
};
```

#### B. **Output Type**

```ts
interface FillSegment {
  songId: string; // caller supplies or derived from file name
  startTick: number;
  endTick: number;
  startMs: number;
  endMs: number;

  // heuristic scores
  densityZ: number;
  tomRatioJump: number;
  hatDropout: number;
  kickDrop: number;
  ioiStdZ: number;
  ngramNovelty: number;
  samePadBurst: boolean;
  crashResolve: boolean;
  grooveDist: number;
}
```

---

### 4 · Architecture & Module Layout

```
src/
 ├── index.ts              // public API: extractFills(parsedChart, cfg?)
 ├── config.ts             // defaultConfig const + Config type
 ├── drumLaneMap.ts        // helpers to map NoteType → voice category
 ├── quantize.ts           // snap ticks to grid, util fns
 ├── features/
 │    ├── windowStats.ts   // compute per-window feature vector F
 │    ├── grooveModel.ts   // rolling μ & Σ, mahalanobis distance
 │    └── novelty.ts       // n-gram cache
 ├── detector/
 │    ├── candidateMask.ts // apply thresholds to windows
 │    └── mergeSegments.ts // fuse adjacent positives, duration gate
 ├── utils/
 │    ├── tempoUtils.ts    // tick ↔ ms helpers
 │    └── math.ts          // z-score, covariance, etc.
 └── __tests__/
```

---

### 5 · Algorithmic Flow

> **Tick vs Beat Conversion**
> `chart.resolution` = ticks per quarter note. One _beat_ = 4 × resolution. Tempo changes handled by mapping tick→ms via the provided `tempos[]`.

1. **Drum Track Selection**

   ```ts
   const track = chart.trackData.find(
     t => t.instrument === 'drums' && t.difficulty === cfg.difficulty,
   );
   ```

   Flatten `noteEventGroups` into a chronologically sorted `NoteEvent[]`.

2. **Voice Mapping**
   Convert `NoteType` to **VOICE**
   - Kick, Snare, Hat/Ride, Tom, Cymbal/Crash.
     Provide mapping table for Clone Hero / RB lanes.

3. **Quantisation (optional but fast)**
   Snap each `tick` to nearest grid division:
   `quant = cfg.ppq / cfg.quantDiv` (default 192 / 4 = 48 ticks ≈ 16th-note).

4. **Sliding-Window Feature Extraction**
   - **Window size**: 1 beat (4 × resolution ticks)
   - **Stride**: ¼ beat
   - Compute feature vector _F(t)_ (see §6).

5. **Adaptive Groove Model**
   Rolling mean μ and covariance Σ of _F_ over the preceding `lookbackBars` (8 bars default), excluding windows already flagged candidate. Calculate Mahalanobis distance → `grooveDist`.

6. **Candidate Window Mask**
   Positive if any of:

   ```text
    (densityZ > cfg.densityZ  &&  grooveDist > cfg.dist )
     OR (tomRatioJump > cfg.tomJump)
   ```

   Additional gates (hatDropout, kickDrop) act as bonus-weights but are not mandatory.

7. **Segment Merging**
   Adjacent positives (gap ≤ `mergeGapBeats`) → single segment. Discard segments outside `minBeats … maxBeats`.

8. **Per-Fill Score Aggregation**
   For each segment take **mean** of continuous scores and **any()** for booleans. Collect ticks and ms bounds.

9. **Return**

   ```ts
   return FillSegment[]
   ```

---

### 6 · Feature Vector `F` (per sliding window)

| Key            | Description                           | Formula (tick-agnostic) |
| -------------- | ------------------------------------- | ----------------------- |
| `noteDensity`  | hits / beat                           | `hits / windowBeats`    |
| `densityZ`     | z-score vs. groove                    | –                       |
| `tomRatioJump` | (tomHits / total) ÷ rollingMean       | –                       |
| `hatDropout`   | 1 – (hatHits / total) ÷ rollingMean   | clamp ≥ 0               |
| `kickDrop`     | (rollingKickMean − kickHits/beat)     | clamp ≥ 0               |
| `ioiStdZ`      | z-score(IOI std-dev)                  | –                       |
| `ngramNovelty` | unseen 16-tick pattern?               | 0/1                     |
| `samePadBurst` | ≥ 3 hits on same lane IOI < `burstMs` | 0/1                     |
| `crashResolve` | next down-beat first hit is cymbal    | 0/1                     |
| `grooveDist`   | Mahalanobis(F, μ, Σ)                  | –                       |

---

### 7 · Configuration (TypeScript-friendly)

```ts
export interface Config {
  difficulty?: 'expert' | 'hard' | 'medium' | 'easy';
  quantDiv?: 4; // smaller → finer grid
  windowBeats?: 1;
  strideBeats?: 0.25;
  lookbackBars?: 8;
  thresholds: {
    densityZ: number;
    dist: number;
    tomJump: number;
    minBeats: number;
    maxBeats: number;
    mergeGapBeats: number;
    burstMs: number;
  };
}

export const defaultConfig: Config = {
  difficulty: 'expert',
  quantDiv: 4,
  windowBeats: 1,
  strideBeats: 0.25,
  lookbackBars: 8,
  thresholds: {
    densityZ: 1.2,
    dist: 2.0,
    tomJump: 1.5,
    minBeats: 0.75,
    maxBeats: 4,
    mergeGapBeats: 0.25,
    burstMs: 120,
  },
};
```

---

### 8 · Error Handling

- **Missing drum track** → throw `DrumTrackNotFoundError`.
- **Zero note events** → return `[]`.
- **Covariance singular** (too few windows) → use diagonal Σ.

---

### 9 · Testing Plan (Jest)

| Layer           | Test Case                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Unit**        | density calc on 16-note synthetic array                                                                                               |
|                 | Mahalanobis distance vs. expected value                                                                                               |
| **Integration** | full pipeline on fixture charts:<br>• single known fill<br>• dense blast beat with one tom break<br>• shuffle groove (expect 0 fills) |
| **Property**    | running extractor twice yields deep-equal arrays                                                                                      |
| **Performance** | 10 × 5-min fixture ≤ 1 s CI timeout                                                                                                   |

---

### 10 · Future-Proof Extensions

- Plug-in alternative heuristics via feature middleware.
- Persist output to SQLite for cross-song queries.
- Web UI to audition fills (WebAudio + Tone.js).
- Lightweight ML classifier to replace hand-tuned thresholds.

---

### 11 · Open Items

| Topic                                             | Decision Needed                          |
| ------------------------------------------------- | ---------------------------------------- |
| Voice mapping for uncommon lanes (orange cymbal)  | include as “cymbal” by default           |
| Handling of simultaneous hits (flams) in IOI calc | treat duplicates at same tick as one hit |
| Output ordering                                   | songId ascending -> startTick ascending  |

---

### 12 · Public API Sketch

```ts
import {extractFills, defaultConfig} from 'drum-fill-extractor';

const fills = extractFills(parsedChart, {
  ...defaultConfig,
  thresholds: {densityZ: 1.3},
});
console.log(fills[0].startMs, fills[0].densityZ);
```

---

**End of Document** — suitable for hand-off to a JavaScript/TypeScript engineer or AI coding agent.
