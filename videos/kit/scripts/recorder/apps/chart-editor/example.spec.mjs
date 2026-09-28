// An example chart editor take: the spec format with generic moves only
// (glide, key, click, park) and no song seconds. Every frame is placed by
// the scene's beats, and the one target is the song time of a beat, found
// on the piano roll the product draws that frame. It fits any chart with a
// Guitar Expert track.
//
// The pointer glides into the roll, switches to the Place Note tool (Cmd+2),
// places a note on the Green lane on the third beat of the scene's third
// bar, switches back to the cursor tool (Cmd+1), plays the note through the
// strikeline, undoes it (Cmd+Z) and parks. Pick a spot your chart leaves
// empty, clear of sustain tails too: on an existing note, or a tail's end,
// the Place tool takes that note instead.
//
//   node --import tsx scripts/recorder/apps/chart-editor/record.mjs ... \
//     --spec scripts/recorder/apps/chart-editor/example.spec.mjs

import {inOutCubic} from '../../../../src/motion/easing.ts';
import {Plan} from '../../gestures.mjs';
import {MOD} from '../../session.mjs';
import {EDITOR_COMPONENTS, at} from './spec-kit.mjs';

export default {
  id: 'editor-example',
  description:
    'Guitar Expert, the roll following the playhead: the Place Note tool puts a note on Green on the third beat of the third bar, the note plays through, and Undo takes it back.',
  chart: 'main',
  // A scene of the film's storyboard (--storyboard); rename it to yours.
  scene: 'editor',
  // Only the scene's first four bars.
  window: {bars: 4},
  panelHeight: 360,
  tracks: ['guitar:expert'],
  // The roll's zoom, px per ms of song; it follows the playhead.
  roll: {pxPerMs: 0.2},
  components: [...EDITOR_COMPONENTS, 'highway-guitar-expert'],
  plan({tl, fps, beat}) {
    const p = new Plan({fps});
    // The third beat of the scene's third bar, as the song time it plays.
    const note = at(tl.songAt(beat(2, 2)).songSec, 'Green');
    p.glide(note, beat(0, 2), beat(1), inOutCubic);
    p.key(beat(1), '2', {modifiers: MOD.meta});
    p.click(note, beat(1, 1));
    p.key(beat(1, 2), '1', {modifiers: MOD.meta});
    p.note(
      beat(1),
      beat(1, 2),
      'place',
      'Cmd+2, a click on Green at the third bar, third beat, Cmd+1',
    );
    p.key(beat(3), 'z', {modifiers: MOD.meta});
    p.note(beat(3), beat(3), 'undo', 'Cmd+Z takes the placed note back');
    p.park(beat(3, 2));
    return p;
  },
};
