# 0056 — Waveform/notes misalignment on the highway

## Problem

The highway waveform is offset from the notes by a constant ~67ms.
Reported with an A/B chart (constant 120bpm, machine-predicted drum
notes that sit exactly on audio transients): in Moonscraper the notes
line up with the waveform exactly; on our highway every transient is
displaced relative to its note.

## Root causes

1. **Mesh-bottom vs strikeline.** Notes are placed with
   `worldY = (ms - cur)/1000 * highwaySpeed - 1` (SceneReconciler), so
   "now" is y = -1 (the receptor line). The waveform mesh is centered
   at `MESH_BASE_Y = -0.1` with height 2, so its bottom edge is at
   y = -1.1 — but `WaveformSurface.update` drew `currentTimeMs` at that
   bottom edge. The whole waveform is therefore shifted 0.1 world
   units = `0.1 / highwaySpeed` seconds ≈ 66.7ms relative to notes.
   GridOverlay is unaffected (it uses the note formula).
2. **Chart delay ignored.** `update()` receives chart time, but the
   PCM index must be audio time = chart time + chartDelay
   (audioManager.ts). Charts with a song.ini `delay` shift the
   waveform by that amount. (Moonscraper applies `-song.offset`.)

## Fix

- In `WaveformSurface.update`, map the texture's bottom row to
  `currentTimeMs + (MESH_BASE_Y / highwaySpeed) * 1000` so that y = -1
  shows exactly `currentTimeMs`. Extract the offset math into a pure,
  unit-tested helper.
- At the render-loop callsite, pass audio time
  (`elapsedTime + chartDelay * 1000`) into `waveformSurface.update`.

## Verification

Load the A/B chart (`~/Desktop/phantom-limb-ab/Phantom Limb (current)`)
in /preview waveform mode; isolated kick/snare transients must be
centered on their gems at the strikeline.
