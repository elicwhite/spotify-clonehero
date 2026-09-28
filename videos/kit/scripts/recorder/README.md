# Recorder: any running web app, frame by frame, on a film's clock

The recorder drives a real Chrome over the DevTools protocol and records a
running web app one film frame at a time. Nothing in the page can see real
time pass, so how fast the machine captures never shows in the result: a
take is a pure function of its spec, and two takes of one spec are
byte-identical. Output is one H.264 video per UI component plus a
manifest; films play them with `src/recorder` (`RecordedLayer`).

`record.mjs` records any page from a spec. `apps/chart-editor/` is the chart
editor's adapter (chart import, tracks, zoom, the song-time pin, the piano
roll's geometry, the edit log): see its README. Both are
`recordCli(adapter)` (`record-cli.mjs`): the flags every take shares are
parsed there with the kit's CLI helpers (scripts/lib/cli.ts), and an
adapter adds only its own flags and steps. The flags are spelled as the
kit's flag table has them (scripts/lib/README.md): `--range` for a range of
frames, `--frames` for a list, `--length` for a count, `--keep <dir>` for
frames kept as PNG, `--app-url` for the page, and seconds carry `-sec`.
Every spec hook gets the same hook context (`ctx`, spec.ts).

## How it works

- `virtual-clock.js` is injected before any page script. After
  `__recClock.enter({at})` time only moves when the harness moves it:
  `performance.now`, `requestAnimationFrame`, `setTimeout` /
  `setInterval`, every `AudioContext`'s `state` and `currentTime` (each
  reads `at` seconds at `enter()`; one created later starts suspended at
  0), and CSS transitions and animations (paused and seeked). The page's
  date (`Date.now()`, `new Date()`, `Date()`) is never the real one: from
  the tab's opening it runs from a fixed date base, in real time through
  setup and its reloads, then in virtual time from `enter()`, so it is the
  same in every take (the tab's time zone, locale and languages are fixed
  too: UTC, en-US). The clock start (default 60 s) and the date (default
  2026-01-01 12:00 UTC at the pre-roll start) are fixed, so absolute
  timestamps are the same in every take; setup must take less than the
  clock start, or `enter()` refuses (the date would go back). Timers and
  animation frames the page queued before `enter()` move onto the virtual
  clock (restarted there: what they had left in real time differs between
  takes). A frame the browser did not paint in time (a hidden or throttled
  window) is reported in the manifest's `pageErrors`.
- It does NOT cover Web Workers (their clocks and timers are their own),
  `requestIdleCallback`, media elements (`<video>`, `<audio>`),
  `performance.timeOrigin`, `Event.timeStamp` or `document.timeline`. The
  header of virtual-clock.js has the full list. State the page built in real
  time before `enter()` (a count of ticks, say) differs between takes: set
  the page up so its state does not depend on how long setup took.
- The worker gate (in the clock, driven from `worker-gate.mjs`) holds the
  messages of the next worker the page creates after `armWorkerGate(page)`
  and hands them to the page one at a time on the frames the plan chooses
  (`deliverWhen(page, ready, what)`), so a worker's reply lands on a planned
  frame however long it really took.
- `fiber.js` (`window.__recFiber`) reads a React app's own objects from the
  DOM: context values, `useRef` values, the fiber that holds a ref. App
  probes use it to aim input at what the app drew. `dom.js`
  (`window.__recDom`) is the one element-box helper every part measures
  with (`box`, `boxes`, `centre`).
- The frame loop (`frame-loop.mjs`), per film frame: pin the app's own
  clock (a spec hook), advance the virtual clock to the frame's time firing
  due timers, send the frame's input (`gestures.mjs`: real CDP mouse, keys,
  wheel, or calls), run one animation frame inside a real browser frame and
  let the page settle and paint, take one screenshot, read the frame's data
  back (a hook) and check the app kept time (a hook). Frames before the
  first captured one are a pre-roll.
- `encoder.mjs`: one ffmpeg process (the kit's `ffmpegArgs`) takes the
  PNGs over stdin and writes one video per component crop (4:4:4 CRF 12 by
  default, the kit's BT.709 chain and tags, a keyframe every half second
  for Remotion's out-of-order reads). No frames touch the disk.
- `take.mjs` (`recordTake`) is one take: a fresh tab, the setup in real
  time, the clock stopped, the loop, the manifest (`manifest.ts`).
  `record.mjs` and the adapters differ only in what they pass it.

## Setup: a Chrome for the recorder

A full Chrome with its own profile and a CDP port. It must be visible (not
minimized): the clock runs each frame's callbacks inside a real browser
frame. On macOS, from outside the Bash sandbox:

```sh
open -na "Google Chrome" --args --remote-debugging-port=<port> \
  --user-data-dir="$TMPDIR/<profile>" --window-size=520,360 --window-position=0,0 \
  --no-first-run --no-default-browser-check --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding --disable-background-timer-throttling \
  --autoplay-policy=no-user-gesture-required about:blank
```

This is not the headless Chrome Remotion renders with
(`videos/node_modules/.remotion`); the recorder needs a real, painting
window. The page's viewport is emulated, so the window can stay small.

Two hazards, both found the hard way:

- **The real mouse.** A real pointer over the recording window reaches the
  page (hover halos, button states) and changes the take. Keep the window
  small in a screen corner (or move it with `Browser.setWindowBounds`) and
  the mouse away from it.
- **A second display.** Keep the window on one display. A window on another
  display renders text and colours differently, and every take changes.

## Record a page

```sh
node --import tsx kit/scripts/recorder/record.mjs \
  --cdp http://127.0.0.1:<port> --spec <take>.spec.mjs --out <film>/public/generated/rec \
  [--app-url <page>] [--timeline <timeline.json> --storyboard <storyboard module>] \
  [--range a-b] [--preroll-sec 0.5] [--handle-sec 0.5] [--clock-start-sec 60] \
  [--clock-date <ISO date>] [--keep <dir> --frames 10,20] \
  [--crf 12 --preset slow --pix-fmt yuv444p] [--no-encode]
```

Run it without flags for the full list. Every path, port and URL comes from
the command line or the spec; scratch files go to a temporary folder that
is removed afterwards. The spec format is documented at the top of
`spec.ts`: where the take sits (explicit `frames` with the spec's `fps`, or
a storyboard `scene` placed on the film's beats by `film-time.ts`, with half
a second of handle on each side), the components to crop (CSS selectors,
boxes, or the whole viewport), setup steps, per-frame hooks, and the input
plan (`new Plan({fps})`):

- `glide(target, from, to, ease)` (`ease`: a kit easing, default
  `inOutCubic`), `place(target, f)`, `press(f)`, `release(f)`,
  `click(target, f, {holdFrames})` (default 0.05 s),
  `drag(fromTarget, toTarget, pressFrame, releaseFrame)`,
  `key(f, key, {modifiers: MOD.meta})`, `wheel(f, target, {deltaX, deltaY})`,
  `park(f)` (the pointer back off the app; the exported cursor hides),
  `call(f, fn)` (harness code on a frame), `note(from, to, kind, text)` (an
  entry in the manifest's `interactions`).
- Targets are functions of the live state that frame, so a drag lands on
  what the app drew. Input sent on frame f is handled before f's animation
  frame, so its effect is in f's screenshot.
- Place frames by the music (`beat(bar, beat)` from the scene's first bar,
  `tl.frameOfSong(sec, segment)`) or relative to the take, never by a typed
  film frame, so a take follows a new edit of the music.

## Check the harness: the self-test

```sh
node --import tsx kit/scripts/recorder/selftest.mjs --cdp http://127.0.0.1:<port> [--keep gallery/public/generated/rec]
```

It serves a test page from a scratch folder (CSS animations, a CSS
transition on a clicked button, a canvas loop drawn from rAF time, a clock
readout driven by an interval started before the clock stops, a key
readout, a gated Web Worker), records it twice, and fails unless every
video, the manifest and every frame's screenshot are byte-identical and
every frame differs from the one before. Run it on a new machine or Chrome
before trusting a take.

## Land a take

Land a take only when a second take of the same spec (or the take it
replaces) is byte-identical to it on every component video the film uses,
manifest included:

```sh
node --import tsx kit/scripts/recorder/compare-takes.mjs <take folder> <other take folder> [--components window,pianoRoll]
```

Chrome's anti-aliasing can change under GPU load (another render on the
machine): now and then one frame of a take differs from its twin by a few
pixels at up to a dozen grey levels, on an anti-aliased edge in the canvas or
the DOM alike. The frame is settled when it is captured (a second screenshot
of it is identical), and the encoder carries the difference to the end of
its keyframe group. Record again until two takes match. Spot checks of a few
PNGs (`--keep <dir> --frames`) can miss a stray frame; compare the videos.

To look at a take, tile its reference PNGs with ffmpeg (`xstack`), or render
the gallery's `Recorder-FrameCheck` at a film frame and compare it with the
harness's PNG of that frame (about 50 dB PSNR when it is the right frame, 25
for a neighbour).

## Files

| File                                                   | What                                                                                                                                                     |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cdp.mjs`                                              | A minimal CDP client (Node's WebSocket); `page.emulate({width, height, scale, colorScheme})`.                                                            |
| `virtual-clock.js`, `fiber.js`, `dom.js`               | Page scripts: the clock (with the worker gate), the React fiber helpers, element boxes.                                                                  |
| `session.mjs`                                          | A tab with the page scripts, capture hygiene (no scrollbars, no dev badge), real clicks and keys, `mcp()` (the page's WebMCP tools), `measureSelectors`. |
| `gestures.mjs`                                         | `Plan` and its `Executor`.                                                                                                                               |
| `frame-loop.mjs`, `take.mjs`                           | The frame loop and one whole take.                                                                                                                       |
| `encoder.mjs`, `manifest.ts`                           | The videos and the manifest.                                                                                                                             |
| `film-time.ts`, `spec.ts`                              | A film's timeline and storyboard for placing takes; the spec format.                                                                                     |
| `worker-gate.mjs`, `cors-bridge.mjs`, `zip-folder.mjs` | The worker gate's harness side; CORS for an asset host that does not list the app's origin; a folder packed into a store zip.                            |
| `record-cli.mjs`                                       | `recordCli(adapter)`: the command line every recorder shares.                                                                                            |
| `record.mjs`, `selftest.mjs`, `compare-takes.mjs`      | The command-line tools above.                                                                                                                            |
| `apps/chart-editor/`                                   | The chart editor's adapter.                                                                                                                              |
