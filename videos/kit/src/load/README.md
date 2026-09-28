# load

Files named by their path in `public/`, and loading what a frame needs
before Remotion may capture it.

```tsx
import {loadJson, publicUrl, useLoaded} from '@musiccharts/video-kit/load';

const PATH = 'generated/credits.json';

const Credits: React.FC = () => {
  const credits = useLoaded(
    PATH,
    () => loadJson<{lines: string[]}>(PATH, {writtenBy: 'scripts/credits.ts'}),
    'Loading credits',
  );
  if (!credits) return null; // the frame is held until the next render
  return <img src={publicUrl('generated/credits.png')} />;
};
```

| Export                                 | What it is                                                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publicUrl(path)`                      | The URL the bundle serves a public path at (`staticFile`; a leading slash is allowed). In a render, a URL that is already served throws instead of doubling.                 |
| `useLoaded(key, load, label)`          | Runs `load` once per page per `key` and holds the frame (`delayRender(label)`) until a render with the value has committed. A failed load cancels the render with its error. |
| `fetchFile(path, {writtenBy?, init?})` | `fetch` of a public path that throws `"public/<path> is missing (HTTP 404). <writtenBy> writes it."` on a failed response                                                    |
| `loadJson<T>(path, {writtenBy?})`      | `fetchFile` and parse                                                                                                                                                        |

## Rules

- Every kit API names a file by its path relative to `public/`
  (`generated/timeline.json`), never a URL. `publicUrl` is the one place
  such a path becomes a URL; no other kit module calls `staticFile`.
- `key` identifies the load: every component asking for the same key shares
  one load and its result, so pick a key that names what is loaded (usually
  the path).
- Name the script that writes a generated file in `writtenBy`, so a missing
  file tells the reader how to make it.
