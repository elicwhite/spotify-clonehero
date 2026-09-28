# blender

The brand logo sting: the mark built procedurally in Blender (the lucide
"music" glyph as raised white tubes on a beveled rounded square in the brand
colours), animated on a film's musical events and rendered as a square RGBA
PNG sequence over transparency. The kit's `LogoSting` player (`src/brand`)
places it in the film. Tested with Blender 5.2.

The mark pops in on the first push and flies in from depth, tumbling, with
motion blur; on the impact it is exactly frontal at full size, squashed in
depth, then recoils and wobbles once; each flash nudges it and lights the
matching lane-coloured rim; from the rest frame it idles (a few pixels of
float, a small sway, a sheen across the face on each sheen frame) and ends
exactly at rest. Durations are in seconds, so the motion is the same at any
frame rate.

## Make one

Commands run from `videos/kit`.

```bash
# 1. The brand colours
node --import tsx scripts/brand/write-brand-json.ts --out <dir>/brand.json

# 2. The events, from the film's timeline: the kicks inside the sting, a flash
#    per guitar note in the run after the impact, a sheen per downbeat
#    (--timeline is timeline.json, or a module exporting the timeline, such as a
#    loop-bed film's src/music.ts: --timeline <film>/src/music.ts [--export timeline])
node --import tsx blender/stingEvents.ts --timeline <film>/public/generated/timeline.json \
  --length <frames> --out <dir>/sting-events.json [--from <film frame>] [--flash-window-sec 0.5]

# 3. The sequence (Blender on the command line; on macOS it is
#    Blender.app/Contents/MacOS/Blender)
blender -b --factory-startup --python blender/logo_sting.py -- \
  --events <dir>/sting-events.json --brand <dir>/brand.json --size 1080 \
  --out <film>/public/generated/logo-sting

# 4. Review files: the sequence over black with the soundtrack, key frames, every frame of the hit
node --import tsx blender/preview.ts --in <film>/public/generated/logo-sting \
  --meta <film>/public/generated/logo-sting.json --out <dir>/review [--mix <mix.wav>] [--font monospace]
```

Previews and stills:

```bash
blender -b --factory-startup --python blender/logo_sting.py -- --events <events.json> \
  --brand <brand.json> --size 256 --samples 8 --out <dir> --frames 0,15,21,30
blender ... --still <rest.png> --size 2048 --samples 128     # the resting pose
blender ... --meta <file.json>                               # the schedule only, no render
blender ... --save-blend <file.blend>                        # the built scene
```

`logo_sting.py` flags: `--events`, `--brand`, `--size` (the square frame
side, px) are required; `--fps`, `--from` (the film frame of sting frame 0)
and `--length` default to the events file's own and must agree with it when
both are given; `--samples` (Eevee, default 64). The brand JSON is
`{colors: {primary, accent, lanes: {green, red, yellow, blue, orange}}}`
(`src/brand/brandJson.ts`). Rendering needs Blender's GPU access, so run it
outside a sandbox that blocks it. Any error exits 1.

`stingEvents.ts` takes the kicks from the timeline's hits as frames
(`hitFrames.kick` of the music API), so the sting lands on the same frames
the film's cues do. `--from` defaults to the film's end minus `--length`:
the sting closes the film.

## The events file

Film frames. `stingEvents.ts` writes all of it; a hand-written one may leave
out `fps`, `start` and `length` and pass them as flags.

```json
{
  "version": 1,
  "fps": 60,
  "start": 2370,
  "length": 330,
  "kicks": [2382, 2415],
  "flashes": [{"frame": 2420, "lane": 2}],
  "sheens": [2460, 2520]
}
```

`lane` is 0-4 (green, red, yellow, blue, orange) or the name. Missing
events degrade gracefully: with one kick that kick is the impact and the
mark flies in for 0.55 s before it; with none it flies in from the first
frame. Flashes before the impact, and sheens too close to the rest frame or
the end, are dropped (and logged).

## The meta file (what the player reads)

The format is `StingMeta` in `src/brand/stingMeta.ts`; `preview.ts` checks a
meta file with its `assertStingMeta` (every field, and the version), the same
check the `LogoSting` player uses, before it reads a frame.

Written beside the folder as `<out>.json` (or to `--meta`), only for a
complete sequence or on its own without `--out`. Frames are
`<out>/<String(i).padStart(digits, '0')>.png` for every sting frame. Frame
values are sting frames: film frame = `globalStart` + sting frame.

```json
{
  "version": 1,
  "fps": 60,
  "frames": 330,
  "globalStart": 2370,
  "digits": 4,
  "frameSizePx": 1080,
  "appearFrame": 12,
  "impactFrame": 45,
  "flashFrames": [50, 57],
  "restFrames": [64, 329],
  "sheenFrames": [120, 210],
  "rest": {
    "centerPx": [540, 540],
    "squarePx": 454,
    "cornerRadiusPx": 97.286,
    "iconBoxPx": 259.429,
    "strokePx": 21.619
  }
}
```

`appearFrame <= impactFrame <= restFrames[0] <= restFrames[1] = frames - 1`.
Before `appearFrame` the frames are empty. The `rest` geometry is in the
frame's pixels (origin top-left, y down): the resting mark's square, corner
radius, icon box and stroke, for lining the 3D mark up with a flat one.

## Modules

| File                | What                                                               |
| ------------------- | ------------------------------------------------------------------ |
| `logo_sting.py`     | Arguments, the scene, render settings, the meta                    |
| `sting_timing.py`   | The events in sting frames, with the graceful fallbacks            |
| `sting_geometry.py` | The slab and glyph meshes, and the camera framing of the rest pose |
| `sting_look.py`     | Materials in the brand colours, the studio world, the light rig    |
| `sting_motion.py`   | The motion as pure functions of the frame, and the keyframes       |
| `stingEvents.ts`    | The events file from a timeline.json                               |
| `preview.ts`        | The review files                                                   |
