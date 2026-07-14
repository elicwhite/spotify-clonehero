# 0055 — Fix waveform shimmer on the highway

## Problem

The highway waveform (`lib/preview/highway/WaveformSurface.ts`) shimmers
while scrolling: the same audio region renders with a different spike
pattern every frame, as if it re-aliases at each scroll tick. It should
look static, as though painted on the highway.

## Root causes (two)

1. `renderWindow` bucketed samples into canvas rows relative to
   `startSample`, which is derived from `currentTimeMs`. As playback
   scrolls, the row boundaries land on a different set of samples each
   frame, so each row's min/max peak changes frame-to-frame.
2. The 2048-row canvas texture is minified onto far fewer screen
   pixels with `NearestFilter`, so each screen pixel samples a single
   texel and most texels are never displayed at a given scroll phase.
   As the phase sweeps, a different subset of texels gets sampled each
   frame — thin 1-texel peaks sparkle in and out even with stable
   content.

## Fix

Anchor the min/max bucket grid to the audio timeline instead of the
screen:

- Use a constant bucket size in samples (`windowSamples / CANVAS_HEIGHT`,
  both constant), and align the rendered window to a multiple of the
  bucket size (`alignedStart = floor(startSample / bucket) * bucket`).
- Each canvas row then always covers the same fixed slice of audio, so
  its rendered width never changes.
- Absorb the sub-bucket phase (`startSample - alignedStart`) by shifting
  the mesh along the highway by the equivalent world offset
  (< 1 row ≈ 0.001 world units), so scrolling stays smooth.
- Skip re-render when the aligned bucket index hasn't changed (replaces
  the ms quantisation), but still update the mesh phase offset every
  frame.

And fix the texture sampling: `LinearMipmapLinearFilter` +
`generateMipmaps` + anisotropy 8 instead of `NearestFilter`, so
minified sampling averages the full texel footprint rather than
picking a per-frame-different single texel.

## Tests

Unit test in `lib/preview/highway/__tests__/WaveformSurface.test.ts`
for the new pure bucket-alignment helper: same audio time renders into
the same bucket regardless of scroll position; phase offset in [0, 1).
