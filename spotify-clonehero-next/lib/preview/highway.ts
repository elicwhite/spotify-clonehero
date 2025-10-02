import {RefObject} from 'react';
import * as THREE from 'three';
import {Files, ParsedChart} from './chorus-chart-processing';
import {
  Difficulty,
  Instrument,
  noteFlags,
  noteTypes,
} from '@eliwhite/scan-chart';
import {ChartResponseEncore} from '../chartSelection';
import {AudioManager} from './audioManager';

type Track = ParsedChart['trackData'][0];
type NoteGroup = ParsedChart['trackData'][0]['noteEventGroups'][0];
type Note = NoteGroup[0];

export type SelectedTrack = {
  instrument: Instrument;
  difficulty: Difficulty;
};

export type Song = {};

const SCALE = 0.105;
const NOTE_SPAN_WIDTH = 0.99;

const NOTE_COLORS = {
  green: '#01B11A',
  red: '#DD2214',
  yellow: '#DEEB52',
  blue: '#006CAF',
  orange: '#F8B272',
};

const GUITAR_LANE_COLORS = [
  NOTE_COLORS.green,
  NOTE_COLORS.red,
  NOTE_COLORS.yellow,
  NOTE_COLORS.blue,
  NOTE_COLORS.orange,
];

let instanceCounter = 0;

export const setupRenderer = (
  metadata: ChartResponseEncore,
  chart: ParsedChart,
  sizingRef: RefObject<HTMLDivElement>,
  ref: RefObject<HTMLDivElement>,
  audioManager: AudioManager,
) => {
  instanceCounter++;
  const highwaySpeed = 1.5;

  const camera = new THREE.PerspectiveCamera(90, 1 / 1, 0.01, 10);
  camera.position.z = 0.8;
  camera.position.y = -1.3;
  camera.rotation.x = THREE.MathUtils.degToRad(60);

  const renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.localClippingEnabled = true;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  function setSize() {
    const width = sizingRef.current?.offsetWidth ?? window.innerWidth;
    const height = sizingRef.current?.offsetHeight ?? window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }
  setSize();

  function onResize() {
    setSize();
  }
  window.addEventListener('resize', onResize, false);

  ref.current?.children.item(0)?.remove();
  ref.current?.appendChild(renderer.domElement);

  // let audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  // let trackOffset = 0;
  // audioCtx.suspend();

  // async function sizingRefClicked() {
  //   if (audioCtx.state === 'running') {
  //     await audioCtx.suspend();
  //     console.log('Paused at', trackOffset + audioCtx.currentTime * 1000);
  //   } else if (audioCtx.state === 'suspended') {
  //     await audioCtx.resume();
  //   } else if (audioCtx.state === 'closed') {
  //     if (isSongOver()) {
  //       await methods.seek({percent: 0});
  //     }
  //   }
  // }

  let progressInterval: number;

  const textureLoader = new THREE.TextureLoader();

  const highwayBeginningPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1);
  const highwayEndPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.9);
  const clippingPlanes = [highwayBeginningPlane, highwayEndPlane];

  async function initialize() {
    const highwayTexture: THREE.Texture =
      await getHighwayTexture(textureLoader);

    return {
      highwayTexture,
    };
  }

  const initPromise = initialize();
  let trackPromise: ReturnType<typeof prepTrack>;

  const methods = {
    prepTrack(track: Track) {
      const scene = new THREE.Scene();
      trackPromise = prepTrack(scene, track);
      console.log('track', track);
      return trackPromise;
    },

    async startRender() {
      const {scene, highwayGroups, highwayTexture} = await trackPromise;
      // const {audioCtx: audioContext, audioSources} =
      //   await setupAudioContext(audioFiles);
      // // Update the audio context
      // audioCtx = audioContext;
      // audioCtx.onstatechange = () => {
      //   playPauseListener(audioCtx.state === 'running');
      // };

      await startRender(
        scene,
        highwayTexture,
        highwayGroups,
        // audioSources,
        metadata.song_length || 60 * 5 * 1000,
      );
    },
    // play() {
    //   sizingRefClicked();
    // },
    // pause() {
    //   sizingRefClicked();
    // },
    // async seek({percent, ms}: {percent?: number; ms?: number}) {
    //   if (percent == null && ms == null) {
    //     throw new Error('Must provide percent or ms');
    //   }

    //   const songLength = metadata.song_length || 60 * 5 * 1000;
    //   const offset: number = ms ?? songLength * percent!;
    //   const percentCalculated: number = percent ?? ms! / songLength;
    //   trackOffset = offset;

    //   progressListener(percentCalculated);

    //   if (audioCtx.state !== 'closed') {
    //     audioCtx.close();
    //   }
    //   const {audioCtx: audioContext, audioSources} =
    //     await setupAudioContext(audioFiles);
    //   // Update the audio context
    //   audioCtx = audioContext;
    //   audioCtx.onstatechange = () => {
    //     playPauseListener(audioCtx.state === 'running');
    //   };
    //   audioSources.forEach(source => {
    //     source.start(0, offset / 1000);
    //   });

    //   await audioCtx.resume();
    // },
    destroy: () => {
      // I can't figure out where this was used
      // window.clearInterval(progressInterval);
      console.log('Tearing down the renderer');
      window.removeEventListener('resize', onResize, false);
      // audioCtx.close();
      renderer.setAnimationLoop(null);
    },
  };

  return methods;

  // function isSongOver() {
  //   const elapsedTime = trackOffset + audioCtx.currentTime * 1000;
  //   const songLength = metadata.song_length || 60 * 5 * 1000;

  //   return elapsedTime > songLength + 2000;
  // }

  async function prepTrack(scene: THREE.Scene, track: Track) {
    const {highwayTexture} = await initPromise;

    if (track.instrument == 'drums') {
      scene.add(createDrumHighway(highwayTexture));
      scene.add(await loadAndCreateDrumHitBox(textureLoader));
    } else {
      scene.add(createHighway(highwayTexture));
      scene.add(await loadAndCreateHitBox(textureLoader));
    }

    const highwayGroups = await generateNoteHighway(
      textureLoader,
      track.instrument,
      highwaySpeed,
      clippingPlanes,
      track,
    );
    scene.add(highwayGroups);

    return {
      scene,
      highwayTexture,
      highwayGroups,
    };
  }

  async function startRender(
    scene: THREE.Scene,
    highwayTexture: THREE.Texture,
    highwayGroups: THREE.Group,
    // audioSources: AudioBufferSourceNode[],
    songLength: number,
  ) {
    // If this was cleaned up before running
    // if (audioCtx.state === 'closed') {
    //   return;
    // }

    // audioSources.forEach(source => {
    //   source.start();
    // });

    renderer.setAnimationLoop(animation);

    function animation() {
      if (
        audioManager != null &&
        audioManager.isPlaying &&
        audioManager.isInitialized
      ) {
        const SYNC_MS = (audioManager.delay || 0) * 1000;

        if (audioManager.isPlaying) {
          const elapsedTime = audioManager.currentTime * 1000 - SYNC_MS;

          const scrollPosition = -1 * (elapsedTime / 1000) * highwaySpeed;

          if (highwayTexture) {
            highwayTexture.offset.y = -1 * scrollPosition;
          }

          highwayGroups.position.y = scrollPosition;

          // progressListener(elapsedTime / songLength);
        }
      }

      renderer.render(scene, camera);
    }
  }
};

// async function setupAudioContext(audioFiles: Files) {
//   const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
//   audioCtx.suspend();

//   // 0 to 1
//   const volume = 0.5;

//   const gainNode = audioCtx.createGain();
//   gainNode.connect(audioCtx.destination);
//   // Let's use an x*x curve (x-squared) since simple linear (x) does not
//   // sound as good.
//   // Taken from https://webaudioapi.com/samples/volume/
//   gainNode.gain.value = volume * volume;

//   const audioSources = (
//     await Promise.all(
//       audioFiles.map(async file => {
//         const arrayBuffer = file.data;
//         if (audioCtx.state === 'closed') {
//           // Can happen if cleaned up before setup is done
//           return;
//         }

//         // If we don't copy this, we can only play it once. decode destroys the buffer
//         const bufferCopy = arrayBuffer.slice(0).buffer;
//         let decodedAudioBuffer;
//         try {
//           decodedAudioBuffer = await audioCtx.decodeAudioData(bufferCopy);
//         } catch {
//           try {
//             const decode = await import('audio-decode');
//             decodedAudioBuffer = await decode.default(bufferCopy);
//           } catch {
//             console.error('Could not decode audio');
//             return;
//           }
//         }
//         const source = audioCtx.createBufferSource();
//         source.buffer = decodedAudioBuffer;
//         source.connect(gainNode);
//         return source;
//       }),
//     )
//   ).filter(Boolean) as AudioBufferSourceNode[];

//   return {audioCtx, audioSources};
// }

type DrumModifiers = {};

type GuitarModifiers = {
  isTap: boolean;
  isForce: boolean;
  isStarPower: boolean;
  isOpen: boolean;
};

async function loadNoteTextures(
  textureLoader: THREE.TextureLoader,
  instrument: Instrument,
) {
  const isDrums = instrument == 'drums';

  let strumTextures: THREE.SpriteMaterial[];
  let strumTexturesHopo: THREE.SpriteMaterial[];
  let strumTexturesTap: THREE.SpriteMaterial[];
  let openMaterial: THREE.SpriteMaterial;

  let tomTextures: Awaited<ReturnType<typeof loadTomTextures>>;
  let cymbalTextures: Awaited<ReturnType<typeof loadCymbalTextures>>;
  let kickMaterial: THREE.SpriteMaterial;

  if (isDrums) {
    tomTextures = await loadTomTextures(textureLoader);
    cymbalTextures = await loadCymbalTextures(textureLoader);
    kickMaterial = new THREE.SpriteMaterial({
      map: await textureLoader.loadAsync(
        `/assets/preview/assets2/drum-kick.webp`,
      ),
    });
  } else {
    strumTextures = await loadStrumNoteTextures(textureLoader);
    strumTexturesHopo = await loadStrumHopoNoteTextures(textureLoader);
    strumTexturesTap = await loadStrumTapNoteTextures(textureLoader);
    openMaterial = new THREE.SpriteMaterial({
      map: await textureLoader.loadAsync(`/assets/preview/assets2/strum5.webp`),
    });
  }

  return {
    getTextureForNote(note: Note, {inStarPower}: {inStarPower: boolean}) {
      if (isDrums) {
        if (note.type == noteTypes.greenDrum && note.flags & noteFlags.cymbal) {
          return cymbalTextures.green;
        } else if (
          note.type == noteTypes.greenDrum &&
          note.flags & noteFlags.cymbal
        ) {
          return cymbalTextures.green;
        } else if (
          note.type == noteTypes.blueDrum &&
          note.flags & noteFlags.cymbal
        ) {
          return cymbalTextures.blue;
        } else if (
          note.type == noteTypes.yellowDrum &&
          note.flags & noteFlags.cymbal
        ) {
          return cymbalTextures.yellow;
        } else if (note.type == noteTypes.kick) {
          return kickMaterial;
        } else if (note.type == noteTypes.redDrum) {
          return tomTextures.red;
        } else if (note.type == noteTypes.greenDrum) {
          return tomTextures.green;
        } else if (note.type == noteTypes.blueDrum) {
          return tomTextures.blue;
        } else if (note.type == noteTypes.yellowDrum) {
          return tomTextures.yellow;
        } else {
          throw new Error(`Invalid sprite requested: ${note.type}`);
        }
      } else {
        const textures =
          note.flags & noteFlags.tap
            ? strumTexturesTap
            : note.flags & noteFlags.hopo
              ? strumTexturesHopo
              : strumTextures;
        switch (note.type) {
          case noteTypes.open:
            return openMaterial;
          case noteTypes.green:
            return textures[0];
          case noteTypes.red:
            return textures[1];
          case noteTypes.yellow:
            return textures[2];
          case noteTypes.blue:
            return textures[3];
          case noteTypes.orange:
            return textures[4];
          default:
            throw new Error('Invalid sprite requested');
        }
      }
    },
  };
}

async function loadStrumNoteTextures(textureLoader: THREE.TextureLoader) {
  const noteTextures = [];

  for await (const num of [0, 1, 2, 3, 4]) {
    const texture = await textureLoader.loadAsync(
      `/assets/preview/assets2/strum${num}.webp`,
    );
    noteTextures.push(
      new THREE.SpriteMaterial({
        map: texture,
      }),
    );
  }

  return noteTextures;
}

async function loadStrumHopoNoteTextures(textureLoader: THREE.TextureLoader) {
  const hopoNoteTextures = [];

  for await (const num of [0, 1, 2, 3, 4]) {
    const texture = await textureLoader.loadAsync(
      `/assets/preview/assets2/hopo${num}.webp`,
    );
    hopoNoteTextures.push(
      new THREE.SpriteMaterial({
        map: texture,
      }),
    );
  }

  return hopoNoteTextures;
}

async function loadStrumTapNoteTextures(textureLoader: THREE.TextureLoader) {
  const hopoNoteTextures = [];

  for await (const num of [0, 1, 2, 3, 4]) {
    const texture = await textureLoader.loadAsync(
      `/assets/preview/assets2/tap${num}.png`,
    );
    hopoNoteTextures.push(
      new THREE.SpriteMaterial({
        map: texture,
      }),
    );
  }

  return hopoNoteTextures;
}

async function loadTomTextures(textureLoader: THREE.TextureLoader) {
  const textures = await Promise.all(
    ['blue', 'green', 'red', 'yellow'].map(async color => {
      const texture = await textureLoader.loadAsync(
        `/assets/preview/assets2/drum-tom-${color}.webp`,
      );
      return new THREE.SpriteMaterial({
        map: texture,
      });
    }),
  );

  return {
    blue: textures[0],
    green: textures[1],
    red: textures[2],
    yellow: textures[3],
  };
}

async function loadCymbalTextures(textureLoader: THREE.TextureLoader) {
  const textures = await Promise.all(
    ['blue', 'green', 'red', 'yellow'].map(async color => {
      const texture = await textureLoader.loadAsync(
        `/assets/preview/assets2/drum-cymbal-${color}.webp`,
      );
      return new THREE.SpriteMaterial({
        map: texture,
      });
    }),
  );

  return {
    blue: textures[0],
    green: textures[1],
    red: textures[2],
    yellow: textures[3],
  };
}

async function getHighwayTexture(textureLoader: THREE.TextureLoader) {
  const texture = await textureLoader.loadAsync(
    '/assets/preview/assets/highways/wor.png',
  );

  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;

  texture.repeat.set(1, 2);
  return texture;
}

function createHighway(highwayTexture: THREE.Texture) {
  const mat = new THREE.MeshBasicMaterial({map: highwayTexture});

  const geometry = new THREE.PlaneGeometry(1, 2);
  const plane = new THREE.Mesh(geometry, mat);
  plane.position.y = -0.1;
  plane.renderOrder = 1;
  return plane;
}

function createDrumHighway(highwayTexture: THREE.Texture) {
  const mat = new THREE.MeshBasicMaterial({map: highwayTexture});

  const geometry = new THREE.PlaneGeometry(0.9, 2);
  const plane = new THREE.Mesh(geometry, mat);
  plane.position.y = -0.1;
  plane.renderOrder = 1;
  return plane;
}

async function loadAndCreateHitBox(textureLoader: THREE.TextureLoader) {
  const texture = await textureLoader.loadAsync(
    '/assets/preview/assets/isolated.png',
  );

  const material = new THREE.SpriteMaterial({
    map: texture,
    sizeAttenuation: true,
    transparent: true,
  });

  const aspectRatio = texture.image.width / texture.image.height;

  material.depthTest = false;
  material.transparent = true;

  const scale = 0.19;
  const sprite = new THREE.Sprite(material);
  if (aspectRatio > 1) {
    // Texture is wider than it is tall
    sprite.scale.set(aspectRatio * scale, 1 * scale, 1);
  } else {
    // Texture is taller than it is wide or square
    sprite.scale.set(1 * scale, (1 / aspectRatio) * scale, 1);
  }
  sprite.position.y = -1;
  sprite.renderOrder = 3;

  return sprite;
}

async function loadAndCreateDrumHitBox(textureLoader: THREE.TextureLoader) {
  const texture = await textureLoader.loadAsync(
    '/assets/preview/assets/isolated-drums.png',
  );

  const material = new THREE.SpriteMaterial({
    map: texture,
    sizeAttenuation: true,
    transparent: true,
  });

  const aspectRatio = texture.image.width / texture.image.height;

  material.depthTest = false;
  material.transparent = true;

  const scale = 0.19;
  const sprite = new THREE.Sprite(material);
  if (aspectRatio > 1) {
    // Texture is wider than it is tall
    sprite.scale.set(aspectRatio * scale, 1 * scale, 1);
  } else {
    // Texture is taller than it is wide or square
    sprite.scale.set(1 * scale, (1 / aspectRatio) * scale, 1);
  }
  sprite.position.y = -1;
  sprite.renderOrder = 3;

  return sprite;
}

function calculateNoteXOffset(instrument: Instrument, lane: number) {
  const leftOffset = instrument == 'drums' ? 0.135 : 0.035;

  return (
    leftOffset +
    -(NOTE_SPAN_WIDTH / 2) +
    SCALE +
    ((NOTE_SPAN_WIDTH - SCALE) / 5) * lane
  );
}

async function generateNoteHighway(
  textureLoader: THREE.TextureLoader,
  instrument: Instrument,
  highwaySpeed: number,
  clippingPlanes: THREE.Plane[],
  track: Track,
): Promise<THREE.Group> {
  const groupedNotes = track.noteEventGroups;
  const starPowerSections = track.starPowerSections;

  function inStarPowerSection(time: number) {
    return starPowerSections.some(
      section =>
        time >= section.msTime && time <= section.msTime + section.msLength,
    );
  }

  const highwayGroups = new THREE.Group();

  const {getTextureForNote} = await loadNoteTextures(textureLoader, instrument);

  for (const group of groupedNotes) {
    const time = group[0].msTime;
    const inStarPower = inStarPowerSection(time);

    // const events = new Map<EventType, number>(
    //   group.events.map(event => [event.type, event.length]),
    // );

    const notesGroup = new THREE.Group();
    notesGroup.position.y = (time / 1000) * highwaySpeed - 1;
    highwayGroups.add(notesGroup);

    // Calculate modifiers
    if (instrument == 'drums') {
      // normalizeDrumEvents(events, format);
      for (const note of group) {
        if (note.type === noteTypes.kick) {
          const kickScale = 0.045;
          const sprite = new THREE.Sprite(
            getTextureForNote(note, {inStarPower}),
          );
          sprite.center = new THREE.Vector2(0.5, -0.5);
          const aspectRatio =
            sprite.material.map!.image.width /
            sprite.material.map!.image.height;
          sprite.scale.set(kickScale * aspectRatio, kickScale, kickScale);
          sprite.position.z = 0;
          sprite.material.clippingPlanes = clippingPlanes;
          sprite.material.depthTest = false;
          sprite.material.transparent = true;
          sprite.renderOrder = 1;
          notesGroup.add(sprite);
        } else {
          const lane =
            note.type == noteTypes.redDrum
              ? 0
              : note.type == noteTypes.yellow ||
                  note.type == noteTypes.yellowDrum
                ? 1
                : note.type == noteTypes.blue || note.type == noteTypes.blueDrum
                  ? 2
                  : note.type == noteTypes.green ||
                      note.type == noteTypes.greenDrum ||
                      note.type == noteTypes.orange
                    ? 3
                    : -1;

          if (lane != -1) {
            const noteXPosition = calculateNoteXOffset(instrument, lane);
            const sprite = new THREE.Sprite(
              getTextureForNote(note, {inStarPower}),
            );
            sprite.position.x = noteXPosition;

            sprite.center = new THREE.Vector2(0.5, 0);
            const aspectRatio =
              sprite.material.map!.image.width /
              sprite.material.map!.image.height;
            sprite.scale.set(SCALE * aspectRatio, SCALE, SCALE);
            sprite.position.z = 0;
            sprite.material.clippingPlanes = clippingPlanes;
            sprite.material.depthTest = false;
            sprite.material.transparent = true;
            sprite.renderOrder = 4;
            notesGroup.add(sprite);
          }
        }
      }
    } else {
      for (const note of group) {
        if (note.type === noteTypes.open) {
          const openScale = 0.11;
          const sprite = new THREE.Sprite(
            getTextureForNote(note, {inStarPower}),
          );
          sprite.center = new THREE.Vector2(0.5, 0);
          const aspectRatio =
            sprite.material.map!.image.width /
            sprite.material.map!.image.height;
          sprite.scale.set(openScale * aspectRatio, openScale, openScale);
          // sprite.position.x = -0.9;
          sprite.position.z = 0;
          sprite.material.clippingPlanes = clippingPlanes;
          sprite.material.depthTest = false;
          sprite.material.transparent = true;
          sprite.renderOrder = 4;
          notesGroup.add(sprite);
        } else {
          // Standard note
          const lane =
            note.type == noteTypes.green
              ? 0
              : note.type == noteTypes.red
                ? 1
                : note.type == noteTypes.yellow
                  ? 2
                  : note.type == noteTypes.blue
                    ? 3
                    : note.type == noteTypes.orange
                      ? 4
                      : -1;

          const noteXPosition = calculateNoteXOffset(instrument, lane);

          if (lane != -1) {
            // We should investigate how -1 happens, we probably are missing support for something
            const noteGroup = new THREE.Group();
            notesGroup.add(noteGroup);
            // This likely needs to change from being absolute to being relative to the note
            noteGroup.position.x = noteXPosition;

            const sprite = new THREE.Sprite(
              getTextureForNote(note, {inStarPower}),
            );

            sprite.center = new THREE.Vector2(0.5, 0);
            const aspectRatio =
              sprite.material.map!.image.width /
              sprite.material.map!.image.height;
            sprite.scale.set(SCALE * aspectRatio, SCALE, SCALE);
            sprite.position.z = 0;
            sprite.material.clippingPlanes = clippingPlanes;
            sprite.material.depthTest = false;
            sprite.material.transparent = true;
            sprite.renderOrder = 4;
            noteGroup.add(sprite);

            // Add the sustain

            const length = note.msLength;
            if (length > 0) {
              const mat = new THREE.MeshBasicMaterial({
                color: GUITAR_LANE_COLORS[lane],
                side: THREE.DoubleSide,
              });

              mat.clippingPlanes = clippingPlanes;
              mat.depthTest = false;
              mat.transparent = true;

              const geometry = new THREE.PlaneGeometry(
                SCALE * 0.175,
                (length / 1000) * highwaySpeed,
              );
              const plane = new THREE.Mesh(geometry, mat);

              plane.position.z = 0;
              // This probably needs to change to be relative to the group
              plane.position.y =
                (length! / 1000 / 2) * highwaySpeed + SCALE / 2;
              plane.renderOrder = 2;
              noteGroup.add(plane);
            }
          }
        }
      }
    }
  }

  return highwayGroups;
}
