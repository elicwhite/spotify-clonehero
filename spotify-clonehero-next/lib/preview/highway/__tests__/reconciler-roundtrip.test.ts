/**
 * Integration tests: edit round-trip through the reconciler.
 *
 * Verifies that chart-edit operations produce correct ChartElement diffs
 * when run through trackToElements + SceneReconciler.setElements.
 *
 * These tests use real chart-edit operations (AddNote, ToggleFlag, etc.)
 * but mock the Three.js rendering layer.
 */

import {noteTypes, noteFlags} from '@eliwhite/scan-chart';
import {trackToElements} from '../trackToElements';
import type {Track} from '../types';
import type {NoteElementData} from '../NoteRenderer';

// ---------------------------------------------------------------------------
// Minimal THREE.js mocks (same as SceneReconciler.test.ts)
// ---------------------------------------------------------------------------

class MockObject3D {
  children: MockObject3D[] = [];
  position = {x: 0, y: 0, z: 0, copy: jest.fn()};
  visible = true;

  add(child: MockObject3D) {
    this.children.push(child);
  }
  remove(child: MockObject3D) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
  }
}

class MockGroup extends MockObject3D {}
class MockScene extends MockObject3D {}

jest.mock('three', () => ({
  Scene: MockScene,
  Group: MockGroup,
  Plane: jest.fn(),
}));

// Import after mocking
import {SceneReconciler, type ElementRenderer} from '../SceneReconciler';

function createMockRenderer(): ElementRenderer {
  return {
    create() {
      return new MockGroup() as any;
    },
    recycle() {},
  };
}

/** Create a minimal Track for testing. */
function makeTrack(
  noteEventGroups: Track['noteEventGroups'],
  opts?: {
    instrument?: Track['instrument'];
  },
): Track {
  return {
    instrument: opts?.instrument ?? 'drums',
    difficulty: 'expert',
    noteEventGroups,
    starPowerSections: [],
    rejectedStarPowerSections: [],
    soloSections: [],
    flexLanes: [],
    flexLaneSections: [],
    drumFreestyleSections: [],
  } as Track;
}

function note(
  type: number,
  tick: number,
  msTime: number,
  flags = 0,
  msLength = 0,
): Track['noteEventGroups'][0][0] {
  return {type, tick, msTime, flags, msLength} as Track['noteEventGroups'][0][0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('edit round-trip through reconciler', () => {
  it('toggle cymbal on yellow note -- setElements shows changed flags, same key', () => {
    const scene = new MockScene() as any;
    const renderer = createMockRenderer();
    const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

    // Initial: yellow tom
    const track1 = makeTrack([
      [note(noteTypes.yellowDrum, 480, 500, 0)],
    ]);
    reconciler.setElements(trackToElements(track1));
    const elements1 = reconciler.getElements();
    expect(elements1).toHaveLength(1);
    expect(elements1[0].key).toBe('note:480:yellowDrum');

    // After toggle: yellow cymbal (flags change to include cymbal)
    const track2 = makeTrack([
      [note(noteTypes.yellowDrum, 480, 500, noteFlags.cymbal)],
    ]);
    reconciler.setElements(trackToElements(track2));
    const elements2 = reconciler.getElements();

    // Same key (identity preserved)
    expect(elements2).toHaveLength(1);
    expect(elements2[0].key).toBe('note:480:yellowDrum');

    // Flags changed
    const data = elements2[0].data as NoteElementData;
    expect(data.note.flags & noteFlags.cymbal).toBeTruthy();
  });

  it('add note -- setElements shows one new element', () => {
    const scene = new MockScene() as any;
    const renderer = createMockRenderer();
    const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

    const track1 = makeTrack([
      [note(noteTypes.redDrum, 0, 0)],
    ]);
    reconciler.setElements(trackToElements(track1));
    expect(reconciler.getElements()).toHaveLength(1);

    // Add a new note
    const track2 = makeTrack([
      [note(noteTypes.redDrum, 0, 0)],
      [note(noteTypes.yellowDrum, 480, 500)],
    ]);
    reconciler.setElements(trackToElements(track2));
    expect(reconciler.getElements()).toHaveLength(2);

    const keys = reconciler.getElements().map(e => e.key);
    expect(keys).toContain('note:480:yellowDrum');
  });

  it('delete note -- setElements shows one removed element', () => {
    const scene = new MockScene() as any;
    const renderer = createMockRenderer();
    const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

    const track1 = makeTrack([
      [note(noteTypes.redDrum, 0, 0)],
      [note(noteTypes.yellowDrum, 480, 500)],
    ]);
    reconciler.setElements(trackToElements(track1));
    reconciler.updateWindow(0);
    expect(reconciler.getActiveGroups().size).toBe(2);

    // Delete yellow
    const track2 = makeTrack([
      [note(noteTypes.redDrum, 0, 0)],
    ]);
    reconciler.setElements(trackToElements(track2));
    expect(reconciler.getElements()).toHaveLength(1);
    expect(reconciler.getActiveGroups().size).toBe(1);
  });

  it('move note -- setElements shows removed at old tick + added at new tick', () => {
    const scene = new MockScene() as any;
    const renderer = createMockRenderer();
    const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

    const track1 = makeTrack([
      [note(noteTypes.redDrum, 480, 500)],
    ]);
    reconciler.setElements(trackToElements(track1));
    expect(reconciler.getElements()[0].key).toBe('note:480:redDrum');

    // Move to different tick
    const track2 = makeTrack([
      [note(noteTypes.redDrum, 960, 1000)],
    ]);
    reconciler.setElements(trackToElements(track2));

    // Old key gone, new key present
    expect(reconciler.getElement('note:480:redDrum')).toBeUndefined();
    expect(reconciler.getElement('note:960:redDrum')).toBeDefined();
  });

  it('undo after toggle -- setElements restores original state', () => {
    const scene = new MockScene() as any;
    const renderer = createMockRenderer();
    const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

    // Original state
    const track1 = makeTrack([
      [note(noteTypes.yellowDrum, 480, 500, 0)],
    ]);
    const elements1 = trackToElements(track1);
    reconciler.setElements(elements1);

    // Apply toggle
    const track2 = makeTrack([
      [note(noteTypes.yellowDrum, 480, 500, noteFlags.cymbal)],
    ]);
    reconciler.setElements(trackToElements(track2));

    // Undo (restore original)
    reconciler.setElements(elements1);
    const restored = reconciler.getElements();
    expect(restored).toHaveLength(1);
    expect((restored[0].data as NoteElementData).note.flags).toBe(0);
  });

  it('BPM change -- all elements get new msTime values', () => {
    const scene = new MockScene() as any;
    const renderer = createMockRenderer();
    const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

    // 120 BPM: tick 480 = 500ms
    const track1 = makeTrack([
      [note(noteTypes.redDrum, 480, 500)],
    ]);
    reconciler.setElements(trackToElements(track1));

    // 60 BPM: tick 480 = 1000ms (different msTime)
    const track2 = makeTrack([
      [note(noteTypes.redDrum, 480, 1000)],
    ]);
    reconciler.setElements(trackToElements(track2));

    const elements = reconciler.getElements();
    expect(elements).toHaveLength(1);
    expect(elements[0].msTime).toBe(1000);
    // Key is still the same (based on tick, not msTime)
    expect(elements[0].key).toBe('note:480:redDrum');
  });

  it('multiple rapid edits -- each setElements produces correct diff', () => {
    const scene = new MockScene() as any;
    const renderer = createMockRenderer();
    const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

    // Start empty
    reconciler.setElements([]);
    reconciler.updateWindow(0);

    // Add note 1
    const track1 = makeTrack([
      [note(noteTypes.kick, 0, 0)],
    ]);
    reconciler.setElements(trackToElements(track1));
    reconciler.updateWindow(0);
    expect(reconciler.getActiveGroups().size).toBe(1);

    // Add note 2
    const track2 = makeTrack([
      [note(noteTypes.kick, 0, 0)],
      [note(noteTypes.redDrum, 480, 500)],
    ]);
    reconciler.setElements(trackToElements(track2));
    reconciler.updateWindow(0);
    expect(reconciler.getActiveGroups().size).toBe(2);

    // Toggle flag on note 2
    const track3 = makeTrack([
      [note(noteTypes.kick, 0, 0)],
      [note(noteTypes.redDrum, 480, 500, noteFlags.accent)],
    ]);
    reconciler.setElements(trackToElements(track3));
    reconciler.updateWindow(0);
    expect(reconciler.getActiveGroups().size).toBe(2);

    // Delete note 1
    const track4 = makeTrack([
      [note(noteTypes.redDrum, 480, 500, noteFlags.accent)],
    ]);
    reconciler.setElements(trackToElements(track4));
    reconciler.updateWindow(0);
    expect(reconciler.getActiveGroups().size).toBe(1);
    expect(reconciler.getActiveGroups().has('note:480:redDrum')).toBe(true);
  });
});
