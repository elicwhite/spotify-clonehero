# Plan 0068: Highway feature parity with chart-preview (6-fret, drum dynamics, texture bake)

> **Source review 2026-07-20:** `~/projects/chart-preview` (Geomitron's
> `chart-preview@1.3.0`, THREE.js, actively maintained — last commits
> 2026-02) renders instrument features our highway lacks. Its architecture
> is *behind* ours (no reconciler, no interaction layer, no schema —
> hardcoded `InstrumentType` branches: lane math `ChartPreview.ts:1653-1707`,
> texture matrix `:1369-1510`), so we borrow feature semantics and data,
> not structure.
> **Dependencies:** 0067 (schema threading; its InteractionManager/schema
> APIs are shaped for this plan — see 0067 "Forward-compatibility notes").

## What chart-preview has that we lack

1. **6-fret GHL** (guitarghl/bassghl/rhythmghl/coop): open + black1-3 +
   white1-3 sharing 3 visual slots, plus **barre chords synthesized** in a
   pre-render pass when >1 note occupies a GHL lane-group in a chord
   (custom note types 99991-3, `ChartPreview.ts:1579-1625`). Narrower
   highway (0.7) and its own strikeline.
2. **Drum extras:** ghost/accent **dynamics textures** (we have the flag
   bindings but no distinct visuals), **disco flip** (red↔yellow +
   tom↔cymbal chart-adjust, `:1626-1647`), double-kick texture reuse.
3. **Star-power note skins:** SP phrases fold into the texture key
   (`-sp` variants) rather than only a highway overlay. chart-preview OR-s a
   synthetic SP flag bit at adjust time (`:1552-1577`); we already compute
   `inStarPower` per element in `trackToElements.ts` — keep our
   data-carried approach, add the texture variants.
4. **Open-note sustain rendering:** 5× width tail for open (`:1207`);
   kick/open sprite center/scale special-casing.
5. Parsed-but-unrendered in both: solo sections, flex lanes, drum
   freestyle — parity here means parity of omission (fine).
6. **Not in chart-preview either:** vocals highway, keys-specific visuals,
   real/pro instruments. Out of scope.

## Design

1. **Schema extensions** (`lib/chart-edit/instruments/`):
   - `sixFretSchema` family: lanes open/black1-3/white1-3 with the existing
     `variant` disambiguator for slot-sharing; `highwayWidth` on
     `InstrumentSchema` (five-fret 1.0, drums 0.9, six-fret 0.7);
     `sustainWidthMultiplier` on `LaneDefinition` (open = 5×).
   - **`normalizeForRender?(track, chart)` hook on the schema** — the home
     for barre synthesis, disco flip, and any future chart-adjust. Runs in
     `trackToElements` on a derived copy; **mutation/selection ids remain
     real-note-only** (0067 contract). Synthetic elements (barre) carry a
     `derivedFrom: EntityRef[]` so hover/select can resolve to real notes.
2. **Texture matrix as the enumeration contract:** adopt chart-preview's
   `(noteType|lane, flags-incl-SP) → material` map shape in
   `TextureManager`, keeping our local naming. Full products:
   five-fret `lane × {strum,hopo,tap} × {sp}`; drums
   `color × {tom,cymbal} × {,ghost,accent} × {sp}` + kick`{,sp}`; six-fret
   `{open,black,white,barre} × {strum,hopo,tap} × {sp}`.
3. **Renderer:** `NotesManager`/`NoteRenderer` read scale/center/width from
   the schema lane (kick/open stop being type-conditionals);
   sustain tails use `sustainWidthMultiplier`; strikeline + highway width
   from schema.
4. **HOPO/tap:** no derivation needed — scan-chart flags are the source in
   both renderers; we already read them.

## Asset pipeline (`~/Downloads/Textures`)

The folder is **Unity authoring source** (paired `.meta` files,
`fiveFretAtlas.spriteAtlas`, sprite strips like
`spr_star_notes_strip4.png`, and GHL notes as *layered components* —
body/ring/cuttout/glow — `Note_Spritesheets/GHL/`, 50 files). It is a
superset in the wrong format: chart-preview loads flat per-variant files
(`preview-6fret-white-hopo-sp.webp`) from `static.enchor.us`; our
`TextureManager` loads local `strum{N}.webp`-style files.

- **Bake step required:** a script (offline, checked into `scripts/`) that
  composites GHL layers, slices sprite strips, and emits flat per-variant
  webp files in *our* naming convention into `public/assets/preview/`.
  Drums mapping: `Standard`→base, `Accents`→`-accent`, `StarNote`/`sp
  shine`→`-sp` (no ghost source found — likely a tint; decide at bake
  time). HUD/rockmeter/menu art in the folder is out of scope.
- Licensing/footprint gate before shipping: see the earlier texture
  decision (grayscale bank, footprint concern) — bake locally first,
  decide what ships with the same criteria.

## Tasks

1. Schema: `highwayWidth`, `sustainWidthMultiplier`, `sixFretSchema`
   family, `normalizeForRender` hook (empty for existing schemas).
2. Texture bake script + baked five-fret/drums variant sets (SP + dynamics
   skins for existing instruments first — no new instrument needed).
3. TextureManager matrix keyed by (lane, flags+SP); wire SP + ghost/accent
   skins into the existing drum/five-fret paths.
4. Disco flip via `normalizeForRender` on the drum schemas.
5. Six-fret: bake GHL assets, schema geometry (`worldXOffset`, 3-slot
   layout), render path incl. barre synthesis + open sustain width.
6. `/ghl-edit`? No — six-fret ships render-only (preview + sheet-music
   pipelines); editing waits for demand and for 0067's id-format caveats.

## Tests

- `normalizeForRender`: barre synthesis (chord in lane-group → one barre
  element with `derivedFrom`), disco flip (red↔yellow, tom↔cymbal,
  discoNoflip stripped) — port chart-preview's semantics as fixtures.
- Texture matrix enumeration: every (schema, lane, legal-flag combo)
  resolves to a material; missing-asset fails loudly at load, not blank.
- Six-fret trackToElements: lane/slot mapping, barre replacement, open
  sustain width.
- Existing drum/five-fret rendering unchanged with the matrix in place.

## Out of scope

- Vocals highway, keys-specific visuals, pro/real instruments.
- Solo/flex-lane/freestyle rendering (unrendered in chart-preview too).
- Animated WebP note textures (chart-preview's `ImageDecoder` pipeline) —
  static variants first.
- GHL editing UI.
