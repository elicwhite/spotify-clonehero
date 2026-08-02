import * as THREE from 'three';
import {noteFlags, noteTypes} from '@eliwhite/scan-chart';
import {
  loadHighwayFlameTextures,
  loadHighwayFretTextures,
  loadNoteTextures,
} from '../TextureManager';
import type {Note} from '../types';

/**
 * Stub TextureLoader that resolves every load with a fresh dummy texture
 * instead of hitting the network. `isImageDecoderSupported()` is false in
 * jsdom, so `loadNoteTextures` always routes through `loadAsync` here.
 */
class StubTextureLoader {
  requestedUrls: string[] = [];

  async loadAsync(url: string): Promise<THREE.Texture> {
    this.requestedUrls.push(url);
    const texture = new THREE.Texture();
    texture.name = url;
    return texture;
  }
}

function note(type: number, flags: number = noteFlags.none): Note {
  return {type, flags} as unknown as Note;
}

describe('loadNoteTextures texture matrix', () => {
  it('resolves a material for every legal (lane, flag) combo for drums', async () => {
    const {getTextureForNote} = await loadNoteTextures(
      new StubTextureLoader() as unknown as THREE.TextureLoader,
      'drums',
    );

    const tomTypes = [
      noteTypes.redDrum,
      noteTypes.yellowDrum,
      noteTypes.blueDrum,
      noteTypes.greenDrum,
    ];
    const cymbalTypes = [
      noteTypes.yellowDrum,
      noteTypes.blueDrum,
      noteTypes.greenDrum,
    ];
    const dynamicFlags = [noteFlags.none, noteFlags.ghost, noteFlags.accent];

    for (const type of tomTypes) {
      for (const dynamic of dynamicFlags) {
        for (const sp of [false, true]) {
          const material = getTextureForNote(
            note(type, noteFlags.tom | dynamic),
            {
              inStarPower: sp,
            },
          );
          expect(material).toBeInstanceOf(THREE.SpriteMaterial);
        }
      }
    }

    for (const type of cymbalTypes) {
      for (const dynamic of dynamicFlags) {
        for (const sp of [false, true]) {
          const material = getTextureForNote(
            note(type, noteFlags.cymbal | dynamic),
            {inStarPower: sp},
          );
          expect(material).toBeInstanceOf(THREE.SpriteMaterial);
        }
      }
    }

    for (const flags of [noteFlags.none, noteFlags.doubleKick]) {
      for (const sp of [false, true]) {
        const material = getTextureForNote(note(noteTypes.kick, flags), {
          inStarPower: sp,
        });
        expect(material).toBeInstanceOf(THREE.SpriteMaterial);
      }
    }
  });

  it('resolves a material for every legal (lane, flag) combo for five-fret', async () => {
    const {getTextureForNote} = await loadNoteTextures(
      new StubTextureLoader() as unknown as THREE.TextureLoader,
      'guitar',
    );

    const coloredLanes = [
      noteTypes.green,
      noteTypes.red,
      noteTypes.yellow,
      noteTypes.blue,
      noteTypes.orange,
    ];
    const modifiers = [noteFlags.strum, noteFlags.hopo, noteFlags.tap];

    for (const type of coloredLanes) {
      for (const modifier of modifiers) {
        for (const sp of [false, true]) {
          const material = getTextureForNote(note(type, modifier), {
            inStarPower: sp,
          });
          expect(material).toBeInstanceOf(THREE.SpriteMaterial);
        }
      }
    }

    for (const sp of [false, true]) {
      const material = getTextureForNote(note(noteTypes.open), {
        inStarPower: sp,
      });
      expect(material).toBeInstanceOf(THREE.SpriteMaterial);
    }
  });

  it('requests square (unstyled) tom URLs by default', async () => {
    const loader = new StubTextureLoader();
    await loadNoteTextures(loader as unknown as THREE.TextureLoader, 'drums');

    expect(
      loader.requestedUrls.some(url => url.includes('drum-tom-red.webp')),
    ).toBe(true);
    expect(
      loader.requestedUrls.some(url =>
        url.includes('drum-tom-red-ghost-sp.webp'),
      ),
    ).toBe(true);
    expect(loader.requestedUrls.some(url => url.includes('-round-'))).toBe(
      false,
    );
  });

  it('requests round-styled tom URLs when tomStyle is "round"', async () => {
    const loader = new StubTextureLoader();
    await loadNoteTextures(
      loader as unknown as THREE.TextureLoader,
      'drums',
      undefined,
      'round',
    );

    expect(
      loader.requestedUrls.some(url => url.includes('drum-tom-round-red.webp')),
    ).toBe(true);
    expect(
      loader.requestedUrls.some(url =>
        url.includes('drum-tom-round-red-ghost-sp.webp'),
      ),
    ).toBe(true);
    // Cymbals must be unaffected by the tom style parameter.
    expect(
      loader.requestedUrls.some(url => url.includes('drum-cymbal-round')),
    ).toBe(false);
  });

  it('uses dedicated open HOPO art and aliases open taps to it', async () => {
    const loader = new StubTextureLoader();
    const {getTextureForNote} = await loadNoteTextures(
      loader as unknown as THREE.TextureLoader,
      'bass',
    );

    const open = (flags: number, inStarPower = false) =>
      getTextureForNote(note(noteTypes.open, flags), {inStarPower});

    expect((open(noteFlags.none).map as THREE.Texture).name).toContain(
      '/open.webp',
    );
    expect((open(noteFlags.strum).map as THREE.Texture).name).toContain(
      '/open.webp',
    );
    expect((open(noteFlags.hopo).map as THREE.Texture).name).toContain(
      '/open-hopo.webp',
    );
    expect((open(noteFlags.tap).map as THREE.Texture).name).toContain(
      '/open-hopo.webp',
    );
    expect((open(noteFlags.none, true).map as THREE.Texture).name).toContain(
      '/open-sp.webp',
    );
    expect((open(noteFlags.hopo, true).map as THREE.Texture).name).toContain(
      '/open-hopo-sp.webp',
    );
    expect(
      loader.requestedUrls.some(url => url.endsWith('/open-hopo-sp.webp')),
    ).toBe(true);
  });
});

describe('loadHighwayFlameTextures', () => {
  it('loads the fretted and open playline animations as frame sets', async () => {
    const loader = new StubTextureLoader();
    const textures = await loadHighwayFlameTextures(
      loader as unknown as THREE.TextureLoader,
    );

    // jsdom has no ImageDecoder, so each animated WebP falls back to its
    // first frame while still exercising the production URL contract.
    expect(textures.hit).toHaveLength(1);
    expect(textures.open).toHaveLength(1);
    expect(loader.requestedUrls).toEqual([
      '/assets/preview/assets2/highway-hit-flame.webp',
      '/assets/preview/assets2/highway-open-flame.webp',
    ]);
  });
});

describe('loadHighwayFretTextures', () => {
  it('loads the supported seven-layer fret composition, including the pick arc', async () => {
    const loader = new StubTextureLoader();
    const textures = await loadHighwayFretTextures(
      loader as unknown as THREE.TextureLoader,
    );

    expect(Object.keys(textures)).toEqual(['first', 'second', 'third']);
    expect(Object.keys(textures.first)).toEqual([
      'base',
      'inner_color',
      'cover',
      'half_cover',
      'head',
      'head_light',
      'pick',
    ]);
    expect(loader.requestedUrls).toHaveLength(21);
    expect(loader.requestedUrls.every(url => url.includes('/frets/'))).toBe(
      true,
    );
  });
});
