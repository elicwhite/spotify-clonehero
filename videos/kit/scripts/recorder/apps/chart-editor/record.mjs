#!/usr/bin/env node
// Record the running chart editor frame by frame, on a film's clock. The
// flags every recorder shares are in ../../record-cli.mjs; run it without
// flags to see them all.
//
//   node --import tsx kit/scripts/recorder/apps/chart-editor/record.mjs \
//     --cdp http://127.0.0.1:9444 \
//     --app-url http://localhost:<port>/chart-editor \
//     --spec <take>.spec.mjs \
//     --chart main=<chart folder | .zip | .sng> [--chart <name>=<path> ...] \
//     --timeline <film>/public/generated/timeline.json \
//     --storyboard <film>/src/storyboard.ts \
//     --out <film>/public/generated/rec
//
// A fresh tab gets the virtual clock and the editor probe before any page
// script runs, imports the chart through the editor's own load screen, and
// is set up with real clicks, keys and wheel events (the spec's tracks,
// panel height and zoom). Then the clock stops, the editor's own seek puts
// the playhead at the pre-roll start and its own play command starts
// playback. For every film frame the editor's playback position is pinned to
// the film's song time before its animation frame runs, and the harness
// fails the take if the editor ever reports another time.
//
// Output: <out>/<id>/<component>.mp4 and manifest.json (src/recorder's
// `EditorRecording`). Every path, port and URL comes from the command line.
// See README.md in this folder.

import {need} from '../../../lib/cli.ts';
import {toFrames} from '../../../../src/format/format.ts';
import {Plan} from '../../gestures.mjs';
import {recordCli} from '../../record-cli.mjs';
import {elementBoxesJs} from '../../session.mjs';
import {frameGeometry} from './layout.mjs';
import {
  chartOf,
  chartsFromFlags,
  clearCharter,
  EDITOR_VIEWPORT,
  GEOMETRY_JS,
  importChart,
  measureComponents,
  PROBE_SOURCE,
  probe,
  recordedPanes,
  setPanelHeight,
  setVisibleTracks,
  zoomRoll,
} from './session.mjs';
import {panRoll} from './spec-kit.mjs';

/** When, into the pre-roll, a held roll view is panned into place. */
const PAN_AFTER_SEC = 0.2;

recordCli({
  app: 'chart-editor',
  command:
    'node --import tsx kit/scripts/recorder/apps/chart-editor/record.mjs --cdp <url> --app-url <url> --spec <file> --chart main=<path> --timeline <json> --storyboard <module> --out <dir> [flags]',
  usage: `  --app-url <url>            the running chart editor
  --chart <name>=<path>      a chart folder, .zip or .sng; a spec's \`chart\` names one (default main)`,
  options: {
    'app-url': {type: 'string'},
    chart: {type: 'string', multiple: true},
  },
  placedInFilm: true,
  prerollSec: 1.5,
  viewport: () => EDITOR_VIEWPORT,
  take({args, spec, ctx, scratch}) {
    const app = need(args['app-url'], 'app-url');
    const chart = chartOf(spec, chartsFromFlags(args.chart));
    const {tl, fps, start, from, log} = ctx;

    /** The timeline segment a pinned take plays throughout, else undefined. */
    const songSegment = spec.songSegment?.(ctx);
    /**
     * Song time for a film frame: the timeline's edit (seeking at a splice),
     * or, for a take pinned to one segment, that segment extended past its
     * ends.
     */
    const songAt = f => tl.songAt(f, songSegment);

    const layouts = [];
    const layoutIndex = new Map();
    const editLog = [];

    return {
      // The editor follows the OS colour scheme; takes show its dark theme.
      colorScheme: 'dark',
      scripts: [PROBE_SOURCE],
      songAt,
      async setup(page) {
        const href = await importChart(page, {
          app,
          chartPath: chart.file,
          scratch,
        });
        log('project', href);
        // The film credits no charter; setPanelHeight's reload then clears
        // what the song-details dialog leaves on the page.
        await clearCharter(page);
        await setPanelHeight(page, spec.panelHeight);
        await setVisibleTracks(page, spec.tracks);
        if (spec.roll?.spanSec || spec.roll?.pxPerMs)
          await zoomRoll(page, spec.roll, log);
        if (spec.prepare) await spec.prepare(page, ctx);
      },
      async begin(page) {
        // The playhead at the pre-roll start with the editor's own seek, and
        // playback started with its own play command.
        const first = songAt(start);
        await page.eval(`(async () => {
          await navigator.modelContextTesting.executeTool('editor_seek', ${JSON.stringify(JSON.stringify({timeMs: first.songSec * 1000}))});
          window.__recEditor.pin(${first.songSec});
          await navigator.modelContextTesting.executeTool('editor_play', '{}');
          await window.__recClock.settle();
        })()`);
        const transport = await probe(page, 'transport()');
        if (!transport.isPlaying)
          throw new Error('the editor did not start playing');
      },
      // Components the product lays out now, plus fixed boxes a spec names
      // for UI that appears later (a dialog, a toast).
      components: async page => ({
        ...(await measureComponents(page)),
        ...(spec.fixedComponents ?? {}),
      }),
      only: spec.components,
      plan() {
        const plan = spec.plan ? spec.plan(ctx) : new Plan({fps});
        // A held roll view: pan it in the pre-roll (the pan also turns
        // follow off).
        if (spec.roll?.leftSec !== undefined)
          panRoll(
            plan,
            start + Math.round(toFrames(PAN_AFTER_SEC, fps)),
            spec.roll.leftSec,
          );
        return plan;
      },
      hooks: {
        // Pin the song time before the frame's timers and animation frame
        // run; where the take crosses a splice of the edit, seek there as the
        // soundtrack cuts.
        pin(f) {
          const {songSec, segment} = songAt(f);
          const splice = f > start && segment !== songAt(f - 1).segment;
          return `window.__recEditor.pin(${songSec});${splice ? ` await window.__recEditor.audioManager().seekTo(${songSec});` : ''}`;
        },
        // What gesture targets read on frames that need them: the roll, and
        // the spec's element boxes.
        live: `({roll: window.__recEditor.roll(), elements: ${elementBoxesJs(spec.live?.elements ?? {})}})`,
        // What the product held for the frame: its playback position, the
        // geometry it drew with, and (for editing takes) its edit state.
        read: () =>
          `({transport: window.__recEditor.transport(), geometry: ${GEOMETRY_JS}, edit: ${spec.editLog ? 'window.__recEditor.editFrame()' : 'null'}})`,
        assertSync({transport}, f) {
          const {songSec} = songAt(f);
          if (
            Math.abs(transport.currentTime - songSec) > 1e-6 ||
            !transport.isPlaying ||
            transport.delay !== 0
          ) {
            throw new Error(
              `the editor reports ${transport.currentTime}s (playing ${transport.isPlaying}, delay ${transport.delay}), film song time is ${songSec}s`,
            );
          }
        },
        async frameData({geometry, edit}, {f, page}) {
          const {songSec} = songAt(f);
          const geo = geometry.roll
            ? frameGeometry(geometry.roll, songSec * 1000)
            : null;
          const layout = {
            roll: geo ? geo.layout : null,
            panes: recordedPanes(geometry.panes),
          };
          const key = JSON.stringify(layout);
          if (!layoutIndex.has(key)) {
            layoutIndex.set(key, layouts.length);
            layouts.push({fromFrame: f, ...layout});
          }
          if (spec.editLog && edit && (edit.docChanged || f === from)) {
            const [instrument, difficulty] = spec.editLog.track;
            const [fromMs, toMs] = spec.editLog.windowMs;
            editLog.push({
              f,
              undoDepth: edit.undoDepth,
              reason: f === from && !edit.docChanged ? 'initial' : 'edit',
              notes: await page.eval(
                `window.__recEditor.trackNotes(${JSON.stringify(instrument)}, ${JSON.stringify(difficulty)}, ${fromMs}, ${toMs})`,
              ),
            });
          }
          return {
            layout: layoutIndex.get(key),
            roll: geo ? geo.view : null,
            edit: edit
              ? {
                  tool: edit.tool,
                  selectedNotes: edit.selectedNotes,
                  gesture: edit.gesture,
                }
              : undefined,
          };
        },
      },
      extra: () => ({
        setup: {
          tracks: spec.tracks,
          panelHeight: spec.panelHeight,
          roll: spec.roll ?? null,
          chart: chart.name,
          songSegment: songSegment ?? null,
          notes: spec.setupNotes ?? null,
        },
        geometryNote:
          'CSS px of the recorded viewport (`viewport`). Piano roll: x = originX + (songMs - leftMs) * pxPerMs; ' +
          'playheadX is the red playhead. frames[i].layout indexes layouts[] (bands, rows, lanes, highway panes). ' +
          'cursor: the real input position; visible false = parked off the editor; down = button held; over = component under it.',
        layouts,
        editLog: spec.editLog
          ? {
              note: `Chart document after each committed edit (and at the first frame): ${spec.editLog.track.join(' ')} notes with msTime in [${spec.editLog.windowMs.join(', ')}] ms, as the product holds them (tick, msTime, type = scan-chart note type, length in ticks, flags).`,
              entries: editLog,
            }
          : undefined,
      }),
    };
  },
});
