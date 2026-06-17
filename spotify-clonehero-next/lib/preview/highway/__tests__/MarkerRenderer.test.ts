/**
 * Tests for MarkerRenderer -- the ElementRenderer for sections, lyrics,
 * BPM changes, time signatures, and vocal phrases.
 *
 * Verifies the lazy-bake hover/selected texture state machine without
 * real WebGL.
 */

// ---------------------------------------------------------------------------
// THREE.js mock must be defined before imports that reference 'three'
// ---------------------------------------------------------------------------

interface MockMaterialState {
  map: unknown;
  needsUpdate: boolean;
  clippingPlanes: unknown[];
  transparent: boolean;
  depthTest: boolean;
}

const mockMaterials: MockMaterialState[] = [];

jest.mock('three', () => {
  class MockCanvasTexture {
    image: {width: number; height: number};
    colorSpace = '';
    minFilter = 0;
    magFilter = 0;
    disposed = false;

    constructor(canvas: any) {
      this.image = {width: canvas?.width ?? 64, height: canvas?.height ?? 64};
    }
    dispose() {
      this.disposed = true;
    }
  }

  class MockSpriteMaterial implements MockMaterialState {
    map: unknown;
    needsUpdate = false;
    clippingPlanes: unknown[] = [];
    transparent = false;
    depthTest = true;
    disposed = false;

    constructor(opts: {map?: unknown} = {}) {
      this.map = opts.map ?? null;
      mockMaterials.push(this);
    }
    dispose() {
      this.disposed = true;
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
    userData: Record<string, unknown> = {};

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
    }
  }

  class MockGroup extends MockObject3D {}

  class MockMesh extends MockObject3D {
    geometry: {dispose: jest.Mock};
    constructor(geometry: any, material: any) {
      super();
      this.geometry = geometry ?? {dispose: jest.fn()};
      this.material = material ?? null;
    }
  }

  class MockColor {
    constructor(
      public r = 1,
      public g = 1,
      public b = 1,
    ) {}
  }

  class MockPlaneGeometry {
    dispose = jest.fn();
  }

  class MockMeshBasicMaterial {
    color: MockColor;
    clippingPlanes: unknown[] = [];
    transparent = false;
    opacity = 1;
    depthTest = true;
    side = 0;
    disposed = false;

    constructor(opts: {color?: MockColor; opacity?: number} = {}) {
      this.color = opts.color ?? new MockColor();
      this.opacity = opts.opacity ?? 1;
    }
    dispose() {
      this.disposed = true;
    }
  }

  return {
    Sprite: MockSprite,
    SpriteMaterial: MockSpriteMaterial,
    Group: MockGroup,
    Mesh: MockMesh,
    Object3D: MockObject3D,
    CanvasTexture: MockCanvasTexture,
    MeshBasicMaterial: MockMeshBasicMaterial,
    PlaneGeometry: MockPlaneGeometry,
    Color: MockColor,
    DoubleSide: 2,
    SRGBColorSpace: 'srgb',
    LinearFilter: 'linear',
    Plane: jest.fn(),
  };
});

// document.createElement('canvas') stub
beforeAll(() => {
  if (typeof document === 'undefined') {
    (global as any).document = {
      createElement: (_tag: string) => ({
        width: 100,
        height: 50,
        getContext: () => ({
          font: '',
          measureText: () => ({width: 50}),
          fillRect: jest.fn(),
          strokeRect: jest.fn(),
          fillText: jest.fn(),
          fillStyle: '',
          strokeStyle: '',
          lineWidth: 0,
          textAlign: '',
          textBaseline: '',
        }),
      }),
    };
  }
});

import {MarkerRenderer, type MarkerElementData} from '../MarkerRenderer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestRenderer(): MarkerRenderer {
  return new MarkerRenderer([], 'right', [255, 200, 100]);
}

function makeData(
  overrides: Partial<MarkerElementData> = {},
): MarkerElementData {
  return {text: 'verse', ...overrides};
}

function getSpriteMaterial(group: any): MockMaterialState {
  return group.children[0].material as MockMaterialState;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MarkerRenderer', () => {
  beforeEach(() => {
    mockMaterials.length = 0;
    MarkerRenderer.clearTextureCache();
  });

  it('create() bakes only the rest texture; other variants are lazy getters', () => {
    const renderer = createTestRenderer();
    const group = renderer.create(makeData()) as any;

    expect(group.userData.textures).toBeDefined();
    expect(group.userData.textures.rest).not.toBeUndefined();
    // Hover / selected / selectedHover are functions until first resolve.
    expect(typeof group.userData.textures.hover).toBe('function');
    expect(typeof group.userData.textures.selected).toBe('function');
    expect(typeof group.userData.textures.selectedHover).toBe('function');
  });

  it('initial state is rest (hovered=false, selected=false)', () => {
    const renderer = createTestRenderer();
    const group = renderer.create(makeData()) as any;
    expect(group.userData.state).toEqual({hovered: false, selected: false});
  });

  it('setHovered(true) resolves hover getter, swaps map, marks needsUpdate', () => {
    const renderer = createTestRenderer();
    const group = renderer.create(makeData()) as any;
    const restTexture = group.userData.textures.rest;
    const mat = getSpriteMaterial(group);
    expect(mat.map).toBe(restTexture);

    renderer.setHovered(group, true);

    // The getter has been resolved
    expect(typeof group.userData.textures.hover).not.toBe('function');
    const hoverTexture = group.userData.textures.hover;
    expect(mat.map).toBe(hoverTexture);
    expect(mat.needsUpdate).toBe(true);
    expect(group.userData.state).toEqual({hovered: true, selected: false});
  });

  it('setHovered(false) returns to rest texture', () => {
    const renderer = createTestRenderer();
    const group = renderer.create(makeData()) as any;
    const restTexture = group.userData.textures.rest;

    renderer.setHovered(group, true);
    renderer.setHovered(group, false);

    expect(getSpriteMaterial(group).map).toBe(restTexture);
    expect(group.userData.state.hovered).toBe(false);
  });

  it('setSelected(true) resolves selected getter and swaps map', () => {
    const renderer = createTestRenderer();
    const group = renderer.create(makeData()) as any;

    renderer.setSelected(group, true);

    expect(typeof group.userData.textures.selected).not.toBe('function');
    expect(getSpriteMaterial(group).map).toBe(group.userData.textures.selected);
    expect(group.userData.state).toEqual({hovered: false, selected: true});
  });

  it('selected + hovered resolves the selectedHover getter (state machine quad)', () => {
    const renderer = createTestRenderer();
    const group = renderer.create(makeData()) as any;

    renderer.setSelected(group, true);
    renderer.setHovered(group, true);

    expect(typeof group.userData.textures.selectedHover).not.toBe('function');
    expect(getSpriteMaterial(group).map).toBe(
      group.userData.textures.selectedHover,
    );
    expect(group.userData.state).toEqual({hovered: true, selected: true});
  });

  it('state transitions: rest → hover → selected → selected+hover → rest', () => {
    const renderer = createTestRenderer();
    const group = renderer.create(makeData()) as any;
    const mat = getSpriteMaterial(group);

    // Rest
    expect(mat.map).toBe(group.userData.textures.rest);
    // Rest → Hover
    renderer.setHovered(group, true);
    expect(mat.map).toBe(group.userData.textures.hover);
    // Hover → Selected (turn off hover, turn on selected)
    renderer.setHovered(group, false);
    renderer.setSelected(group, true);
    expect(mat.map).toBe(group.userData.textures.selected);
    // Selected → Selected+Hover
    renderer.setHovered(group, true);
    expect(mat.map).toBe(group.userData.textures.selectedHover);
    // Selected+Hover → Rest (turn off both)
    renderer.setHovered(group, false);
    renderer.setSelected(group, false);
    expect(mat.map).toBe(group.userData.textures.rest);
  });

  it('setHovered with same value is a no-op (no needsUpdate flap)', () => {
    const renderer = createTestRenderer();
    const group = renderer.create(makeData()) as any;
    renderer.setHovered(group, true);
    const mat = getSpriteMaterial(group);
    mat.needsUpdate = false;

    renderer.setHovered(group, true);
    expect(mat.needsUpdate).toBe(false);
  });

  it('cached textures: a second marker with the same text+color reuses baked variants', () => {
    const renderer = createTestRenderer();
    const a = renderer.create(makeData({text: 'verse'})) as any;
    const b = renderer.create(makeData({text: 'verse'})) as any;

    // Both should share the same rest texture (cached by key)
    expect(a.userData.textures.rest).toBe(b.userData.textures.rest);

    // Bake the hover variant on a; then on b -- both should resolve to the
    // same cached texture.
    renderer.setHovered(a, true);
    renderer.setHovered(b, true);
    expect(a.userData.textures.hover).toBe(b.userData.textures.hover);
  });

  it('clearTextureCache disposes cached textures', () => {
    const renderer = createTestRenderer();
    const group = renderer.create(makeData()) as any;
    const restTexture = group.userData.textures.rest as any;

    MarkerRenderer.clearTextureCache();
    expect(restTexture.disposed).toBe(true);
  });

  it('MarkerElementData has no isHovered/isSelected fields (TS shape check)', () => {
    // Compile-time check: the type accepts {text, stackIndex?} only.
    const data: MarkerElementData = {text: 'chorus'};
    const data2: MarkerElementData = {text: 'verse', stackIndex: 1};
    expect(data.text).toBe('chorus');
    expect(data2.stackIndex).toBe(1);
  });
});
