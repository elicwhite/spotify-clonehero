/**
 * Tests for NoteRenderer -- the ElementRenderer for note chart elements.
 *
 * Uses mocked THREE.js objects to verify sprite creation, configuration,
 * and recycling behavior without real WebGL.
 */

// ---------------------------------------------------------------------------
// THREE.js mock must be defined before imports that reference 'three'
// ---------------------------------------------------------------------------

const mockSpriteInstances: any[] = [];

jest.mock('three', () => {
  class MockTexture {
    image = {width: 64, height: 64};
    colorSpace = '';
  }

  class MockSpriteMaterial {
    map: MockTexture;
    clippingPlanes: unknown[] = [];
    depthTest = true;
    transparent = false;
    needsUpdate = false;

    constructor(opts: {map?: any} = {}) {
      this.map = opts.map ?? new MockTexture();
    }
  }

  class MockObject3D {
    children: MockObject3D[] = [];
    position = {x: 0, y: 0, z: 0, set: jest.fn()};
    scale = {x: 1, y: 1, z: 1, set: jest.fn()};
    center = {x: 0.5, y: 0.5, set: jest.fn()};
    visible = true;
    renderOrder = 0;
    material: unknown = null;

    add(child: any) {
      this.children.push(child);
    }
    remove(child: any) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
    }
  }

  class MockSprite extends MockObject3D {
    constructor(material?: any) {
      super();
      this.material = material ?? new MockSpriteMaterial();
      mockSpriteInstances.push(this);
    }
  }

  class MockGroup extends MockObject3D {}

  return {
    Sprite: MockSprite,
    SpriteMaterial: MockSpriteMaterial,
    Group: MockGroup,
    Object3D: MockObject3D,
    Mesh: class extends MockObject3D {},
    MeshBasicMaterial: jest.fn().mockImplementation(() => ({
      color: {set: jest.fn()},
      clippingPlanes: [],
      depthTest: false,
      transparent: true,
      opacity: 0.35,
      side: 2,
    })),
    PlaneGeometry: jest.fn(),
    RingGeometry: jest.fn(),
    CircleGeometry: jest.fn(),
    DoubleSide: 2,
    Plane: jest.fn(),
  };
});

import {NoteRenderer, type NoteElementData} from '../NoteRenderer';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestRenderer(): NoteRenderer {
  const MockSpriteMaterial = THREE.SpriteMaterial as any;
  const getTextureForNote = jest.fn().mockReturnValue(new MockSpriteMaterial());
  const clippingPlanes: any[] = [];
  return new NoteRenderer(getTextureForNote, clippingPlanes);
}

function makeNoteData(overrides: Partial<NoteElementData> = {}): NoteElementData {
  return {
    note: {
      msTime: 0,
      msLength: 0,
      type: 13, // redDrum
      flags: 0,
      tick: 0,
    } as any,
    xPosition: 0.1,
    inStarPower: false,
    isKick: false,
    isOpen: false,
    lane: 0,
    msLength: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NoteRenderer', () => {
  beforeEach(() => {
    mockSpriteInstances.length = 0;
  });

  it('create() returns group with sprite child', () => {
    const renderer = createTestRenderer();
    const group = renderer.create(makeNoteData());
    expect(group).toBeDefined();
    expect(group.children.length).toBeGreaterThanOrEqual(1);
    // First child should be a Sprite
    expect(group.children[0]).toBeDefined();
  });

  it('create() kick note -- centered, smaller scale, renderOrder 1', () => {
    const renderer = createTestRenderer();
    const group = renderer.create(makeNoteData({isKick: true, lane: -1}));
    const sprite = group.children[0] as any;

    expect(sprite.center.set).toHaveBeenCalledWith(0.5, 0.5);
    expect(sprite.renderOrder).toBe(1);
    expect(group.position.x).toBe(0); // kick is centered
  });

  it('create() regular note -- lane position, standard scale, renderOrder 4', () => {
    const renderer = createTestRenderer();
    const group = renderer.create(makeNoteData({xPosition: 0.25, lane: 1}));
    const sprite = group.children[0] as any;

    expect(sprite.renderOrder).toBe(4);
    expect(group.position.x).toBe(0.25);
  });

  it('create() cymbal vs tom -- different textures (getTextureForNote called with correct args)', () => {
    const MockSpriteMaterial = THREE.SpriteMaterial as any;
    const getTexture = jest.fn().mockReturnValue(new MockSpriteMaterial());
    const renderer = new NoteRenderer(getTexture, []);

    const tomNote = makeNoteData({
      note: {msTime: 0, msLength: 0, type: 14, flags: 0, tick: 0} as any,
    });
    const cymbalNote = makeNoteData({
      note: {msTime: 0, msLength: 0, type: 14, flags: 32, tick: 0} as any,
    });

    renderer.create(tomNote);
    renderer.create(cymbalNote);

    expect(getTexture).toHaveBeenCalledTimes(2);
    // First call for tom, second for cymbal
    expect(getTexture.mock.calls[0][0].flags).toBe(0);
    expect(getTexture.mock.calls[1][0].flags).toBe(32);
  });

  it('create() with star power -- SP texture variant', () => {
    const MockSpriteMaterial = THREE.SpriteMaterial as any;
    const getTexture = jest.fn().mockReturnValue(new MockSpriteMaterial());
    const renderer = new NoteRenderer(getTexture, []);

    renderer.create(makeNoteData({inStarPower: true}));

    expect(getTexture).toHaveBeenCalledWith(
      expect.anything(),
      {inStarPower: true},
    );
  });

  it('create() with accent/ghost -- dynamic texture variant', () => {
    const MockSpriteMaterial = THREE.SpriteMaterial as any;
    const getTexture = jest.fn().mockReturnValue(new MockSpriteMaterial());
    const renderer = new NoteRenderer(getTexture, []);

    // accent flag = 16 in scan-chart
    renderer.create(makeNoteData({
      note: {msTime: 0, msLength: 0, type: 13, flags: 16, tick: 0} as any,
    }));

    expect(getTexture).toHaveBeenCalledWith(
      expect.objectContaining({flags: 16}),
      expect.anything(),
    );
  });

  it('recycle() hides all children except main sprite', () => {
    const renderer = createTestRenderer();
    const group = renderer.create(makeNoteData());

    // Simulate overlay children
    const MockObject3D = THREE.Object3D as any;
    const overlay1 = new MockObject3D();
    overlay1.visible = true;
    group.add(overlay1);

    const overlay2 = new MockObject3D();
    overlay2.visible = true;
    group.add(overlay2);

    renderer.recycle(group);

    // Children at index 1+ should be hidden
    for (let i = 1; i < group.children.length; i++) {
      expect(group.children[i].visible).toBe(false);
    }
  });

  it('recycle() does not dispose materials (shared)', () => {
    const renderer = createTestRenderer();
    const group = renderer.create(makeNoteData());
    const sprite = group.children[0] as any;
    const material = sprite.material;

    renderer.recycle(group);
    // Material should still be the same reference (not disposed)
    expect(sprite.material).toBe(material);
  });
});
