/**
 * The highway draws notes and grid lines — and nothing else.
 * `HIGHWAY_ELEMENT_KINDS` (`cell.ts`) is the single point that enforces it: it
 * types the reconciler's renderer map and is handed to the reconciler as its
 * accepted-kind allowlist. Every marker kind — section, tempo, time-signature,
 * lyric, phrase — is read and edited in the piano roll.
 *
 * These tests push the *whole* chart projection — the same array
 * `useChartElements` produces, marker kinds included — at a highway-shaped
 * reconciler and pin that only notes survive it, plus the interaction
 * consequence: no rejected kind can ever resolve a hit.
 *
 * Grid lines are `GridOverlay` geometry rather than reconciled elements, so
 * they are unaffected by the allowlist; `HighwayScene.test.ts` covers them.
 */

import * as THREE from 'three';
import {HIGHWAY_ELEMENT_KINDS} from '../cell';
import {SceneReconciler, type ElementRenderer} from '../SceneReconciler';
import {InteractionManager} from '../InteractionManager';
import {buildProjectionFor} from '../projection';
import {drums4LaneSchema} from '@/lib/chart-edit';
import {makeFixtureDoc} from '@/components/chart-editor/__tests__/fixtures';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '@/components/chart-editor/scope';

const HIGHWAY_SPEED = 1.5;
const TIMING = [{tick: 0, msTime: 0, beatsPerMinute: 120}];
const RESOLUTION = 480;

function noopRenderer(): ElementRenderer {
  return {
    create: () => new THREE.Group(),
    recycle: () => {},
  };
}

/** A reconciler built exactly the way `buildHighwayCell` builds one. */
function makeHighwayReconciler(root: THREE.Object3D): SceneReconciler {
  return new SceneReconciler(
    root,
    {note: noopRenderer()},
    HIGHWAY_SPEED,
    HIGHWAY_ELEMENT_KINDS,
  );
}

/** The full element set a lane pushes: notes + every marker kind. */
function fullProjectionElements() {
  const doc = makeFixtureDoc();
  const projection = buildProjectionFor(DEFAULT_DRUMS_EXPERT_SCOPE, doc, null);
  return [...projection.elements, ...projection.markers];
}

function kindsOf(keys: Iterable<string>): Set<string> {
  const kinds = new Set<string>();
  for (const key of keys) kinds.add(key.slice(0, key.indexOf(':')));
  return kinds;
}

describe('HIGHWAY_ELEMENT_KINDS', () => {
  it('is exactly notes', () => {
    expect([...HIGHWAY_ELEMENT_KINDS]).toEqual(['note']);
  });
});

describe('a highway reconciler fed the whole projection', () => {
  it('produces a fixture carrying every kind the highway must reject', () => {
    // Guards the tests below from passing vacuously if the fixture ever stops
    // producing sections, lyrics, phrases, tempo, or time-signature markers.
    const kinds = new Set(fullProjectionElements().map(e => e.kind));
    expect(kinds).toEqual(
      new Set([
        'note',
        'section',
        'lyric',
        'phrase-start',
        'phrase-end',
        'bpm',
        'ts',
      ]),
    );
  });

  it('stores only note elements', () => {
    const reconciler = makeHighwayReconciler(new THREE.Group());
    reconciler.setElements(fullProjectionElements());

    const stored = reconciler.getElements();
    expect(stored.length).toBeGreaterThan(0);
    expect(kindsOf(stored.map(e => e.key))).toEqual(new Set(['note']));
    expect(stored.every(e => HIGHWAY_ELEMENT_KINDS.has(e.kind as never))).toBe(
      true,
    );
  });

  it('never looks a rejected element up by key', () => {
    const reconciler = makeHighwayReconciler(new THREE.Group());
    const elements = fullProjectionElements();
    reconciler.setElements(elements);

    for (const el of elements) {
      const found = reconciler.getElement(el.key);
      if (el.kind === 'note') {
        expect(found).toBeDefined();
      } else {
        expect(found).toBeUndefined();
      }
    }
  });

  it('groups and positions only note elements', () => {
    const root = new THREE.Group();
    const reconciler = makeHighwayReconciler(root);
    reconciler.setElements(fullProjectionElements());
    reconciler.updateWindow(0);

    const active = reconciler.getActiveGroups();
    expect(active.size).toBeGreaterThan(0);
    expect(kindsOf(active.keys())).toEqual(new Set(['note']));
    // Every group the reconciler positioned is mounted under the root; a
    // rejected kind never reaches it.
    expect(root.children).toHaveLength(active.size);
  });

  it('keeps rejected kinds out even when they are the only elements pushed', () => {
    const root = new THREE.Group();
    const reconciler = makeHighwayReconciler(root);
    reconciler.setElements(
      fullProjectionElements().filter(e => e.kind !== 'note'),
    );
    reconciler.updateWindow(0);

    expect(reconciler.getElements()).toEqual([]);
    expect(reconciler.getActiveGroups().size).toBe(0);
    expect(root.children).toHaveLength(0);
    expect(reconciler.getActiveGroupsRevision()).toBe(0);
  });
});

describe('highway hit testing after the de-scope', () => {
  const canvasW = 600;
  const canvasH = 600;

  function makeManager(reconciler: SceneReconciler): InteractionManager {
    const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 10);
    camera.position.set(0, -1.3, 0.8);
    camera.rotation.x = THREE.MathUtils.degToRad(60);
    camera.updateMatrixWorld(true);
    const im = new InteractionManager(
      camera,
      reconciler,
      HIGHWAY_SPEED,
      () => 0,
      drums4LaneSchema,
    );
    im.setTimingData(TIMING, RESOLUTION);
    return im;
  }

  /** Every hit type the column of pixels down the highway's middle yields. */
  function hitTypesDownTheMiddle(im: InteractionManager): Set<string> {
    const types = new Set<string>();
    for (let y = 0; y <= canvasH; y++) {
      const hit = im.hitTest(canvasW / 2, y, canvasW, canvasH);
      if (hit) types.add(hit.type);
    }
    return types;
  }

  it('resolves no marker where a section, lyric, phrase, bpm, or ts hit once would', () => {
    // Same tick, same row, every rejected kind at once: the reconciler never
    // stored them, so the row reads as bare highway.
    const reconciler = makeHighwayReconciler(new THREE.Group());
    reconciler.setElements([
      {key: 'section:480', kind: 'section', msTime: 500, data: {text: 'Verse'}},
      {key: 'lyric:vocals:480', kind: 'lyric', msTime: 500, data: {text: 'la'}},
      {
        key: 'phrase-start:vocals:480',
        kind: 'phrase-start',
        msTime: 500,
        data: {text: '['},
      },
      {
        key: 'phrase-end:vocals:480',
        kind: 'phrase-end',
        msTime: 500,
        data: {text: ']'},
      },
      {key: 'bpm:480', kind: 'bpm', msTime: 500, data: {text: '120'}},
      {key: 'ts:480', kind: 'ts', msTime: 500, data: {text: '4/4'}},
    ]);
    reconciler.updateWindow(0);

    expect(hitTypesDownTheMiddle(makeManager(reconciler))).toEqual(
      new Set(['highway']),
    );
  });
});
