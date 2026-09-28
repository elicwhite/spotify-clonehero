# format

The composition's frame rate, size and title-safe box, and conversions
between frames and seconds.

```tsx
import {toFrames, useFormat} from '@musiccharts/video-kit/format';

const Title: React.FC = () => {
  const {fps, unit, safe} = useFormat();
  const enterFrames = toFrames(0.5, fps);
  return <div style={{left: safe.x, top: safe.y, fontSize: 86 * unit}} />;
};
```

| Export                                     | What it is                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `useFormat(): Format`                      | `{fps, width, height, durationInFrames, unit, cx, cy, aspect, safe, safeWidth}` from `useVideoConfig()` |
| `formatOf(config)`                         | The same, pure, for any `{fps, width, height, durationInFrames}`                                        |
| `REFERENCE_SHORT_SIDE`                     | 1080: the short side the brand tokens' sizes are written for                                            |
| `SAFE_MARGIN`                              | 96: the title-safe margin on every side, reference px (the brand's `space.safe`)                        |
| `toSec(frames, fps)`, `toFrames(sec, fps)` | Conversions; `toFrames` is unrounded                                                                    |

`unit` is `min(width, height) / 1080`: one reference px in the composition's
px. A 1920×1080 and a 1080×1920 composition both have unit 1; 3840×2160
has 2. `safe` is the frame inset by `SAFE_MARGIN * unit` on every side (a
`Rect`, px), and `safeWidth` its width: the widest anything important may
be. The brand's `useLayout()` keeps the slate and headline tokens inside it.

## Rules

- Frame rate and size come from the composition. Pure helpers take `fps`
  as a parameter; there is no film-format constant in the kit.
- Brand sizes are reference px: multiply by `unit`, and keep layout inside
  `safe`.
- `format.ts` is pure (no runtime imports): Node code and the brand tokens
  import it directly. `useFormat` is the one export that needs Remotion,
  alone in `useFormat.ts`.
