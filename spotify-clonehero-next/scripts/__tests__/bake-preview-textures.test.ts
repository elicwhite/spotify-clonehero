import {parseSpriteRects, rectTopYDown} from '../bake-preview-textures';

describe('parseSpriteRects', () => {
  it('extracts named sprite rects from Unity .meta YAML', () => {
    const meta = `
TextureImporter:
  spriteSheet:
    sprites:
    - serializedVersion: 2
      name: strip_0
      rect:
        serializedVersion: 2
        x: 0
        y: 64
        width: 32
        height: 32
    - serializedVersion: 2
      name: strip_1
      rect:
        serializedVersion: 2
        x: 32
        y: 64
        width: 32
        height: 32
`;
    expect(parseSpriteRects(meta)).toEqual([
      {name: 'strip_0', x: 0, y: 64, width: 32, height: 32},
      {name: 'strip_1', x: 32, y: 64, width: 32, height: 32},
    ]);
  });

  it('ignores name lines with no rect fields nearby', () => {
    const meta = `
      name: textureImporterName
      unrelated: true
`;
    expect(parseSpriteRects(meta)).toEqual([]);
  });

  it('returns an empty array for a strip with no sprite entries', () => {
    expect(parseSpriteRects('')).toEqual([]);
  });
});

describe('rectTopYDown', () => {
  it('converts a Unity Y-up rect (origin bottom-left) to a sharp Y-down top offset', () => {
    // A 32-tall rect starting at y=64 in a 128-tall image: its top edge in
    // Y-down space is 128 - 64 - 32 = 32.
    const rect = {name: 'r', x: 0, y: 64, width: 32, height: 32};
    expect(rectTopYDown(rect, 128)).toBe(32);
  });

  it('places a rect flush with the image bottom (y=0) at the bottom in Y-down space', () => {
    const rect = {name: 'r', x: 0, y: 0, width: 32, height: 32};
    expect(rectTopYDown(rect, 128)).toBe(96);
  });

  it('places a rect flush with the image top at top=0 in Y-down space', () => {
    const rect = {name: 'r', x: 0, y: 96, width: 32, height: 32};
    expect(rectTopYDown(rect, 128)).toBe(0);
  });
});
