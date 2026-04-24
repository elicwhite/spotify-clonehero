/**
 * Tests for SceneReconciler -- the generic key-based scene reconciler.
 *
 * Mocks THREE.Scene and THREE.Group to verify diffing, windowing,
 * pooling, and selection logic without real WebGL.
 */

import {
  SceneReconciler,
  type ChartElement,
  type ElementRenderer,
} from '../SceneReconciler';

// ---------------------------------------------------------------------------
// Minimal THREE.js mocks
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

class MockScene extends MockObject3D {
  addedGroups: MockObject3D[] = [];
  removedGroups: MockObject3D[] = [];

  add(obj: MockObject3D) {
    super.add(obj);
    this.addedGroups.push(obj);
  }
  remove(obj: MockObject3D) {
    super.remove(obj);
    this.removedGroups.push(obj);
  }
}

// Mock THREE module at the top level
jest.mock('three', () => ({
  Scene: MockScene,
  Group: MockGroup,
  Plane: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Test renderer
// ---------------------------------------------------------------------------

function createMockRenderer(): ElementRenderer & {
  created: Array<{data: unknown; msTime: number}>;
  recycled: MockGroup[];
} {
  const created: Array<{data: unknown; msTime: number}> = [];
  const recycled: MockGroup[] = [];

  return {
    created,
    recycled,
    create(data: unknown, msTime: number) {
      const group = new MockGroup();
      created.push({data, msTime});
      return group as any;
    },
    recycle(group: any) {
      recycled.push(group);
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function el(
  key: string,
  msTime: number,
  data: unknown = {},
  kind = 'note',
): ChartElement {
  return {key, kind, msTime, data};
}

// HIGHWAY_DURATION_MS from types.ts is 1500
const HIGHWAY_DURATION_MS = 1500;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SceneReconciler', () => {
  // -----------------------------------------------------------------------
  // setElements diffing
  // -----------------------------------------------------------------------

  describe('setElements diffing', () => {
    it('empty -> elements = all creates on updateWindow', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([
        el('note:0:kick', 0),
        el('note:480:redDrum', 500),
      ]);

      // No groups created yet (windowing hasn't run)
      expect(renderer.created).toHaveLength(0);

      // After updateWindow at time 0, elements in range [0, 1500] should be created
      reconciler.updateWindow(0);
      expect(renderer.created).toHaveLength(2);
    });

    it('elements -> empty = all removes', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([el('note:0:kick', 0)]);
      reconciler.updateWindow(0);
      expect(reconciler.getActiveGroups().size).toBe(1);

      reconciler.setElements([]);
      // Active group should be removed
      expect(reconciler.getActiveGroups().size).toBe(0);
      expect(renderer.recycled).toHaveLength(1);
    });

    it('same elements, same data = no creates or removes', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      const data = {noteType: 12, flags: 0};
      reconciler.setElements([el('note:0:kick', 0, data)]);
      reconciler.updateWindow(0);
      expect(renderer.created).toHaveLength(1);

      // Set same elements with same data
      reconciler.setElements([el('note:0:kick', 0, data)]);
      reconciler.updateWindow(0);
      // No additional creates -- the group was kept
      expect(renderer.created).toHaveLength(1);
      expect(renderer.recycled).toHaveLength(0);
    });

    it('same keys, different data = recycle old + create new (update)', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([el('note:0:kick', 0, {flags: 0})]);
      reconciler.updateWindow(0);
      expect(renderer.created).toHaveLength(1);

      // Change data (flags changed)
      reconciler.setElements([el('note:0:kick', 0, {flags: 32})]);
      // Old group should be recycled
      expect(renderer.recycled).toHaveLength(1);

      reconciler.updateWindow(0);
      // New group created
      expect(renderer.created).toHaveLength(2);
    });

    it('mixed: some added, some removed, some unchanged, some changed', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([
        el('note:0:kick', 0, {val: 'a'}),
        el('note:480:redDrum', 500, {val: 'b'}),
        el('note:960:yellowDrum', 1000, {val: 'c'}),
      ]);
      reconciler.updateWindow(0);
      expect(renderer.created).toHaveLength(3);

      reconciler.setElements([
        el('note:0:kick', 0, {val: 'a'}), // unchanged
        el('note:960:yellowDrum', 1000, {val: 'd'}), // changed
        el('note:1440:blueDrum', 1400, {val: 'e'}), // added
      ]);
      // redDrum removed (recycled), yellowDrum changed (recycled)
      expect(renderer.recycled).toHaveLength(2);

      reconciler.updateWindow(0);
      // yellowDrum recreated + blueDrum created = 2 new creates
      expect(renderer.created).toHaveLength(5); // 3 original + 2 new
    });

    it('reordering elements with same keys = no ops (identity by key, not position)', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      const data1 = {val: 'a'};
      const data2 = {val: 'b'};
      reconciler.setElements([
        el('note:0:kick', 0, data1),
        el('note:480:redDrum', 500, data2),
      ]);
      reconciler.updateWindow(0);

      // Reorder
      reconciler.setElements([
        el('note:480:redDrum', 500, data2),
        el('note:0:kick', 0, data1),
      ]);

      // No recycling, no new creates
      expect(renderer.recycled).toHaveLength(0);
      reconciler.updateWindow(0);
      expect(renderer.created).toHaveLength(2); // original 2 only
    });

    it('adding an element between existing ones does not affect neighbors', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      const data = {val: 'x'};
      reconciler.setElements([
        el('note:0:kick', 0, data),
        el('note:960:yellowDrum', 1000, data),
      ]);
      reconciler.updateWindow(0);
      expect(renderer.created).toHaveLength(2);

      // Add between them
      reconciler.setElements([
        el('note:0:kick', 0, data),
        el('note:480:redDrum', 500, data),
        el('note:960:yellowDrum', 1000, data),
      ]);
      // No recycling of neighbors
      expect(renderer.recycled).toHaveLength(0);

      reconciler.updateWindow(0);
      // Only 1 new create (the added one)
      expect(renderer.created).toHaveLength(3);
    });

    it('elements at same tick but different types (chord) are independent', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      const data = {val: 'chord'};
      reconciler.setElements([
        el('note:480:redDrum', 500, data),
        el('note:480:yellowDrum', 500, data),
      ]);
      reconciler.updateWindow(0);
      expect(renderer.created).toHaveLength(2);

      // Remove only one
      reconciler.setElements([el('note:480:yellowDrum', 500, data)]);
      expect(renderer.recycled).toHaveLength(1);
      expect(reconciler.getActiveGroups().size).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Windowing
  // -----------------------------------------------------------------------

  describe('updateWindow', () => {
    it('elements outside window do not get groups created', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      // Element at 3000ms, window [0, 1500]
      reconciler.setElements([el('note:0:kick', 3000)]);
      reconciler.updateWindow(0);
      expect(renderer.created).toHaveLength(0);
      expect(reconciler.getActiveGroups().size).toBe(0);
    });

    it('element entering window gets group created via renderer.create()', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([el('note:0:kick', 500)]);
      reconciler.updateWindow(0);
      expect(renderer.created).toHaveLength(1);
      expect(reconciler.getActiveGroups().size).toBe(1);
    });

    it('element leaving window gets recycled via renderer.recycle()', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([el('note:0:kick', 100)]);
      reconciler.updateWindow(0);
      expect(reconciler.getActiveGroups().size).toBe(1);

      // Advance time well past the scroll-off margin (200ms) so element is recycled
      reconciler.updateWindow(500);
      expect(reconciler.getActiveGroups().size).toBe(0);
      expect(renderer.recycled).toHaveLength(1);
    });

    it('element changed while outside window -- no group churn', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([el('note:0:kick', 5000, {flags: 0})]);
      reconciler.updateWindow(0);
      // Not in window
      expect(renderer.created).toHaveLength(0);

      // Change the element while it's outside the window
      reconciler.setElements([el('note:0:kick', 5000, {flags: 32})]);
      // No recycling since it wasn't active
      expect(renderer.recycled).toHaveLength(0);

      // Now scroll to it
      reconciler.updateWindow(4000);
      expect(renderer.created).toHaveLength(1);
    });

    it('scrolling forward -- groups cycle: old recycled, new created', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([el('note:0:a', 0), el('note:1:b', 2000)]);
      reconciler.updateWindow(0);
      expect(renderer.created).toHaveLength(1); // only 'a' in [0, 1500]

      // Scroll forward past 'a', into range of 'b'
      reconciler.updateWindow(1500);
      // 'a' recycled, 'b' created
      expect(renderer.recycled).toHaveLength(1);
      expect(renderer.created).toHaveLength(2);
    });

    it('seeking backward -- window resets, correct groups visible', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([el('note:0:a', 0), el('note:1:b', 2000)]);

      // Start at 1500 -- only 'b' in range
      reconciler.updateWindow(1500);
      expect(reconciler.getActiveGroups().size).toBe(1);

      // Seek back to 0 -- 'b' leaves, 'a' enters
      reconciler.updateWindow(0);
      expect(reconciler.getActiveGroups().size).toBe(1);
      expect(reconciler.getActiveGroups().has('note:0:a')).toBe(true);
    });

    it('element exactly at window start boundary -- included', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([el('note:0:kick', 1000)]);
      reconciler.updateWindow(1000); // window [1000, 2500]
      expect(reconciler.getActiveGroups().size).toBe(1);
    });

    it('element exactly at window end boundary -- included (strict > check)', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      // window [0, 1500], element at exactly 1500
      reconciler.setElements([el('note:0:kick', HIGHWAY_DURATION_MS)]);
      reconciler.updateWindow(0);
      // Element at exactly HIGHWAY_DURATION_MS should be excluded
      // (msTime > windowEndMs check uses > not >=)
      expect(reconciler.getActiveGroups().size).toBe(1);
    });

    it('element slightly past strikeline is still in window (scroll-off margin)', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      // Element at 100ms, current time at 150ms.
      // Without margin, element would be excluded (100 < 150).
      // With margin, element is still visible for smooth scroll-off.
      reconciler.setElements([el('note:0:kick', 100)]);
      reconciler.updateWindow(150);
      expect(reconciler.getActiveGroups().size).toBe(1);
    });

    it('empty elements list -- no crash, no groups', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([]);
      reconciler.updateWindow(0);
      expect(reconciler.getActiveGroups().size).toBe(0);
      expect(renderer.created).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Diff + Window Interaction
  // -----------------------------------------------------------------------

  describe('setElements + updateWindow integration', () => {
    it('add element inside visible window -- group appears on next updateWindow', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([el('note:0:kick', 0)]);
      reconciler.updateWindow(0);
      expect(reconciler.getActiveGroups().size).toBe(1);

      // Add another element inside visible window
      reconciler.setElements([
        el('note:0:kick', 0),
        el('note:480:redDrum', 500),
      ]);
      reconciler.updateWindow(0);
      expect(reconciler.getActiveGroups().size).toBe(2);
      expect(renderer.created).toHaveLength(2);
    });

    it('remove element inside visible window -- group recycled on next updateWindow', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([
        el('note:0:kick', 0),
        el('note:480:redDrum', 500),
      ]);
      reconciler.updateWindow(0);
      expect(reconciler.getActiveGroups().size).toBe(2);

      // Remove one
      reconciler.setElements([el('note:0:kick', 0)]);
      // Element was removed from active groups immediately
      expect(reconciler.getActiveGroups().size).toBe(1);
      expect(renderer.recycled).toHaveLength(1);
    });

    it('change element inside visible window -- old group recycled, new created on next updateWindow', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([el('note:0:kick', 0, {flags: 0})]);
      reconciler.updateWindow(0);

      reconciler.setElements([el('note:0:kick', 0, {flags: 32})]);
      // Old group recycled immediately on setElements
      expect(renderer.recycled).toHaveLength(1);

      reconciler.updateWindow(0);
      // New group created
      expect(renderer.created).toHaveLength(2);
    });

    it('change element outside visible window -- no group churn, correct when scrolled to', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([el('note:0:far', 5000, {flags: 0})]);
      reconciler.updateWindow(0);
      expect(renderer.created).toHaveLength(0);

      reconciler.setElements([el('note:0:far', 5000, {flags: 32})]);
      expect(renderer.recycled).toHaveLength(0);

      reconciler.updateWindow(4000);
      expect(renderer.created).toHaveLength(1);
      expect(renderer.created[0].data).toEqual({flags: 32});
    });

    it('add element then scroll to it -- group created when it enters window', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([]);
      reconciler.updateWindow(0);

      // Add element outside current window
      reconciler.setElements([el('note:0:far', 3000)]);
      reconciler.updateWindow(0);
      expect(reconciler.getActiveGroups().size).toBe(0);

      // Scroll to it
      reconciler.updateWindow(2000);
      expect(reconciler.getActiveGroups().size).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Pooling
  // -----------------------------------------------------------------------

  describe('group lifecycle', () => {
    it('recycled groups are disposed, new groups are always freshly created', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([el('note:0:kick', 0)]);
      reconciler.updateWindow(0);
      expect(renderer.created).toHaveLength(1);

      // Remove and recycle
      reconciler.setElements([]);
      expect(renderer.recycled).toHaveLength(1);

      // Add new element -- creates a fresh group
      reconciler.setElements([el('note:1:kick', 100)]);
      reconciler.updateWindow(0);
      expect(renderer.created).toHaveLength(2);
    });

    it('different kinds use separate renderers', () => {
      const scene = new MockScene() as any;
      const noteRenderer = createMockRenderer();
      const sectionRenderer = createMockRenderer();
      const reconciler = new SceneReconciler(
        scene,
        {note: noteRenderer, section: sectionRenderer},
        1.5,
      );

      reconciler.setElements([
        el('note:0:kick', 0, {}, 'note'),
        el('section:0:intro', 0, {}, 'section'),
      ]);
      reconciler.updateWindow(0);

      expect(noteRenderer.created).toHaveLength(1);
      expect(sectionRenderer.created).toHaveLength(1);

      // Remove both
      reconciler.setElements([]);
      expect(noteRenderer.recycled).toHaveLength(1);
      expect(sectionRenderer.recycled).toHaveLength(1);
    });

    it('creating new groups after recycling works correctly', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      // Create and recycle many groups
      const elements = Array.from({length: 300}, (_, i) =>
        el(`note:${i}:kick`, i),
      );
      reconciler.setElements(elements);
      reconciler.updateWindow(0);
      reconciler.setElements([]);

      // New elements are created properly
      reconciler.setElements([el('note:0:kick', 0)]);
      reconciler.updateWindow(0);
      expect(reconciler.getActiveGroups().size).toBe(1);
    });

    it('new group is always allocated via renderer.create()', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      // No prior recycled groups
      reconciler.setElements([el('note:0:kick', 0)]);
      reconciler.updateWindow(0);
      expect(renderer.created).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Selection and hover
  // -----------------------------------------------------------------------

  describe('selection and hover', () => {
    it('setSelectedKeys applies highlight to visible groups', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      const selectionCalls: Array<{key: string; selected: boolean}> = [];
      reconciler.setSelectionChangeCallback((key, _group, selected) => {
        selectionCalls.push({key, selected});
      });

      reconciler.setElements([el('note:0:kick', 0)]);
      reconciler.updateWindow(0);

      reconciler.setSelectedKeys(new Set(['note:0:kick']));
      expect(selectionCalls).toHaveLength(1);
      expect(selectionCalls[0]).toEqual({key: 'note:0:kick', selected: true});
    });

    it('setHoveredKey applies hover effect to one group', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      const hoverCalls: Array<{key: string; hovered: boolean}> = [];
      reconciler.setHoverChangeCallback((key, _group, hovered) => {
        hoverCalls.push({key, hovered});
      });

      reconciler.setElements([el('note:0:kick', 0)]);
      reconciler.updateWindow(0);

      reconciler.setHoveredKey('note:0:kick');
      expect(hoverCalls).toHaveLength(1);
      expect(hoverCalls[0]).toEqual({key: 'note:0:kick', hovered: true});
    });

    it('changing selection updates highlights without recreating groups', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      const selectionCalls: Array<{key: string; selected: boolean}> = [];
      reconciler.setSelectionChangeCallback((key, _group, selected) => {
        selectionCalls.push({key, selected});
      });

      reconciler.setElements([
        el('note:0:kick', 0),
        el('note:480:redDrum', 500),
      ]);
      reconciler.updateWindow(0);

      reconciler.setSelectedKeys(new Set(['note:0:kick']));
      expect(selectionCalls).toHaveLength(1);

      // Change selection to different note
      reconciler.setSelectedKeys(new Set(['note:480:redDrum']));
      // Deselect old, select new
      expect(selectionCalls).toHaveLength(3);
      expect(selectionCalls[1]).toEqual({key: 'note:0:kick', selected: false});
      expect(selectionCalls[2]).toEqual({
        key: 'note:480:redDrum',
        selected: true,
      });

      // No new creates
      expect(renderer.created).toHaveLength(2);
    });

    it('selection on element outside window -- no crash, highlight appears when scrolled in', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([el('note:0:far', 5000)]);
      reconciler.updateWindow(0);

      // Select while out of window -- no crash
      reconciler.setSelectedKeys(new Set(['note:0:far']));
      expect(reconciler.isSelected('note:0:far')).toBe(true);
    });

    it('clearing selection removes all highlights', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      const selectionCalls: Array<{key: string; selected: boolean}> = [];
      reconciler.setSelectionChangeCallback((key, _group, selected) => {
        selectionCalls.push({key, selected});
      });

      reconciler.setElements([el('note:0:kick', 0)]);
      reconciler.updateWindow(0);
      reconciler.setSelectedKeys(new Set(['note:0:kick']));

      // Clear
      reconciler.setSelectedKeys(new Set());
      const deselects = selectionCalls.filter(c => !c.selected);
      expect(deselects).toHaveLength(1);
    });

    it('hover cleared on setHoveredKey(null)', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      const hoverCalls: Array<{key: string; hovered: boolean}> = [];
      reconciler.setHoverChangeCallback((key, _group, hovered) => {
        hoverCalls.push({key, hovered});
      });

      reconciler.setElements([el('note:0:kick', 0)]);
      reconciler.updateWindow(0);
      reconciler.setHoveredKey('note:0:kick');

      reconciler.setHoveredKey(null);
      expect(hoverCalls).toHaveLength(2);
      expect(hoverCalls[1]).toEqual({key: 'note:0:kick', hovered: false});
    });
  });

  // -----------------------------------------------------------------------
  // getElement / getElements
  // -----------------------------------------------------------------------

  describe('accessors', () => {
    it('getElement returns element by key in O(1)', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([el('note:0:kick', 0, {val: 42})]);
      const found = reconciler.getElement('note:0:kick');
      expect(found).toBeDefined();
      expect(found!.data).toEqual({val: 42});
    });

    it('getElements returns sorted by msTime', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([
        el('note:2:c', 1000),
        el('note:0:a', 0),
        el('note:1:b', 500),
      ]);
      const elements = reconciler.getElements();
      expect(elements.map(e => e.msTime)).toEqual([0, 500, 1000]);
    });
  });

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('disposes all active groups and clears state', () => {
      const scene = new MockScene() as any;
      const renderer = createMockRenderer();
      const reconciler = new SceneReconciler(scene, {note: renderer}, 1.5);

      reconciler.setElements([el('note:0:kick', 0)]);
      reconciler.updateWindow(0);

      reconciler.dispose();
      expect(reconciler.getActiveGroups().size).toBe(0);
      expect(reconciler.getElements()).toHaveLength(0);
    });
  });
});
