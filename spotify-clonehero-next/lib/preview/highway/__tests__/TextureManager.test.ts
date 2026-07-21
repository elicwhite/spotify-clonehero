import * as THREE from 'three';
import {noteFlags, noteTypes} from '@eliwhite/scan-chart';
import {loadNoteTextures} from '../TextureManager';
import type {Note} from '../types';

/**
 * Stub TextureLoader that resolves every load with a fresh dummy texture
 * instead of hitting the network. `isImageDecoderSupported()` is false in
 * jsdom, so `loadNoteTextures` always routes through `loadAsync` here.
 */
class StubTextureLoader {
  async loadAsync(_url: string): Promise<THREE.Texture> {
    return new THREE.Texture();
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
});
