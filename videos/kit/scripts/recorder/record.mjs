#!/usr/bin/env node
// Record any running web page frame by frame, on a film's clock, as a spec
// describes it (spec.ts has the format). The flags every recorder shares
// are in record-cli.mjs; run it without flags to see them all.
//
//   node --import tsx kit/scripts/recorder/record.mjs \
//     --cdp http://127.0.0.1:9444 --spec <take>.spec.mjs --out <folder of takes> \
//     [--app-url <page>] [--timeline <timeline.json> --storyboard <module>]
//
// Output: <out>/<id>/<component>.mp4 and manifest.json. Every path, port and
// URL comes from the command line or the spec. See README.md.

import {UsageError} from '../lib/cli.ts';
import {Plan} from './gestures.mjs';
import {recordCli} from './record-cli.mjs';
import {elementBoxesJs, measureSelectors} from './session.mjs';
import {DEFAULT_VIEWPORT} from './spec.ts';

recordCli({
  app: 'web',
  command:
    'node --import tsx kit/scripts/recorder/record.mjs --cdp <url> --spec <file> --out <dir> [flags]',
  usage: "  --app-url <url>            the page (default: the spec's `url`)",
  options: {'app-url': {type: 'string'}},
  prerollSec: 0.5,
  viewport: spec => spec.viewport ?? DEFAULT_VIEWPORT,
  take({args, spec, ctx}) {
    const url = args['app-url'] ?? spec.url;
    if (!url)
      throw new UsageError(
        `${spec.id}: no --app-url and no \`url\` in the spec`,
      );
    const {tl, fps, viewport} = ctx;
    return {
      colorScheme: spec.colorScheme ?? null,
      // A page that follows the film's song records the song time of every
      // frame, so the film can check the take against its edit.
      songAt: tl && spec.followsSong ? f => tl.songAt(f) : null,
      async setup(page) {
        await page.navigate(url);
        if (spec.ready) await page.waitFor(spec.ready);
        if (spec.prepare) await spec.prepare(page, ctx);
      },
      begin: spec.begin ? page => spec.begin(page, ctx) : undefined,
      // null: the whole viewport; a CSS selector: measured once the clock
      // stops; a box: as given.
      async components(page) {
        const wanted = spec.components ?? {window: null};
        const measured = await measureSelectors(
          page,
          Object.fromEntries(
            Object.entries(wanted).filter(([, v]) => typeof v === 'string'),
          ),
        );
        return Object.fromEntries(
          Object.entries(wanted).map(([name, v]) => [
            name,
            v === null
              ? {x: 0, y: 0, width: viewport.width, height: viewport.height}
              : typeof v === 'string'
                ? measured[name]
                : v,
          ]),
        );
      },
      plan: () => (spec.plan ? spec.plan(ctx) : new Plan({fps})),
      hooks: {
        pin: spec.pin ? f => spec.pin(f, ctx) : undefined,
        // What gesture targets read on frames that need them: the spec's element boxes.
        live: `({elements: ${elementBoxesJs(spec.live?.elements ?? {})}})`,
        read: spec.read ? () => spec.read : undefined,
        frameData: spec.frameData
          ? (value, frame) => spec.frameData(value, {...ctx, ...frame})
          : undefined,
        assertSync: spec.assertSync,
      },
    };
  },
});
