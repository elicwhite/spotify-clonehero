import {RefObject} from 'react';
import * as THREE from 'three';
import {ChartParser} from './chart-parser';
import {MidiParser} from './midi-parser';
import {
  Difficulty,
  EventType,
  GroupedTrackEvent,
  Instrument,
} from 'scan-chart-web';
import {TrackParser} from './track-parser';

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
  chart: ChartParser | MidiParser,
  sizingRef: RefObject<HTMLDivElement>,
  ref: RefObject<HTMLDivElement>,
  audioFiles: ArrayBuffer[],
  progressListener: (percent: number) => void,
  playPauseListener: (isPlaying: boolean) => void,
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

  let audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  let trackOffset = 0;
  audioCtx.suspend();

  async function sizingRefClicked() {
    if (audioCtx.state === 'running') {
      await audioCtx.suspend();
      console.log('Paused at', trackOffset + audioCtx.currentTime * 1000);
    } else if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    } else if (audioCtx.state === 'closed') {
      if (isSongOver()) {
        await methods.seek({percent: 0});
      }
    }
  }

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
    prepTrack(track: TrackParser) {
      const scene = new THREE.Scene();
      trackPromise = prepTrack(scene, track);
      return trackPromise;
    },

    async startRender() {
      const {scene, highwayGroups, highwayTexture} = await trackPromise;
      const {audioCtx: audioContext, audioSources} =
        await setupAudioContext(audioFiles);
      // Update the audio context
      audioCtx = audioContext;
      audioCtx.onstatechange = () => {
        playPauseListener(audioCtx.state === 'running');
      };

      await startRender(
        scene,
        highwayTexture,
        highwayGroups,
        audioSources,
        chart.notesData.length,
      );
    },
    play() {
      sizingRefClicked();
    },
    pause() {
      sizingRefClicked();
    },
    async seek({percent, ms}: {percent?: number; ms?: number}) {
      if (percent == null && ms == null) {
        throw new Error('Must provide percent or ms');
      }

      const songLength = chart.notesData.length;
      const offset: number = ms ?? songLength * percent!;
      const percentCalculated: number = percent ?? ms! / songLength;
      trackOffset = offset;

      progressListener(percentCalculated);

      if (audioCtx.state !== 'closed') {
        audioCtx.close();
      }
      const {audioCtx: audioContext, audioSources} =
        await setupAudioContext(audioFiles);
      // Update the audio context
      audioCtx = audioContext;
      audioCtx.onstatechange = () => {
        playPauseListener(audioCtx.state === 'running');
      };
      audioSources.forEach(source => {
        source.start(0, offset / 1000);
      });

      await audioCtx.resume();
    },
    destroy: () => {
      window.clearInterval(progressInterval);
      console.log('Tearing down the renderer');
      window.removeEventListener('resize', onResize, false);
      audioCtx.close();
      renderer.setAnimationLoop(null);
    },
  };

  return methods;

  function isSongOver() {
    const elapsedTime = trackOffset + audioCtx.currentTime * 1000;
    const songLength = chart.notesData.length;

    return elapsedTime > songLength + 2000;
  }

  async function prepTrack(scene: THREE.Scene, track: TrackParser) {
    const {highwayTexture} = await initPromise;

    if (track.instrument == 'drums') {
      scene.add(createDrumHighway(highwayTexture));
      scene.add(await loadAndCreateDrumHitBox(textureLoader));
    } else {
      scene.add(createHighway(highwayTexture));
      scene.add(await loadAndCreateHitBox(textureLoader));
    }

    const groupedNotes = track.groupedNotes;

    const highwayGroups = await generateNoteHighway(
      textureLoader,
      track.instrument,
      track.format,
      highwaySpeed,
      clippingPlanes,
      groupedNotes,
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
    audioSources: AudioBufferSourceNode[],
    songLength: number,
  ) {
    // If this was cleaned up before running
    if (audioCtx.state === 'closed') {
      return;
    }

    audioSources.forEach(source => {
      source.start();
    });

    renderer.setAnimationLoop(animation);

    function animation() {
      const SYNC_MS =
        (audioCtx.baseLatency +
          // outputLatency is not implemented in safari
          (audioCtx.outputLatency || 0)) *
        1000;
      if (audioCtx.state === 'running') {
        const elapsedTime = trackOffset + audioCtx.currentTime * 1000 - SYNC_MS;
        if (elapsedTime > songLength + 2000) {
          audioCtx.close();
        }

        const scrollPosition = -1 * (elapsedTime / 1000) * highwaySpeed;

        if (highwayTexture) {
          highwayTexture.offset.y = -1 * scrollPosition;
        }

        highwayGroups.position.y = scrollPosition;

        progressListener(elapsedTime / songLength);
      }

      renderer.render(scene, camera);
    }
  }
};

async function setupAudioContext(audioFiles: ArrayBuffer[]) {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.suspend();

  // 0 to 1
  const volume = 0.5;

  const gainNode = audioCtx.createGain();
  gainNode.connect(audioCtx.destination);
  // Let's use an x*x curve (x-squared) since simple linear (x) does not
  // sound as good.
  // Taken from https://webaudioapi.com/samples/volume/
  gainNode.gain.value = volume * volume;

  const audioSources = (
    await Promise.all(
      audioFiles.map(async arrayBuffer => {
        if (audioCtx.state === 'closed') {
          // Can happen if cleaned up before setup is done
          return;
        }

        // If we don't copy this, we can only play it once. decode destroys the buffer
        const bufferCopy = arrayBuffer.slice(0);
        let decodedAudioBuffer;
        try {
          decodedAudioBuffer = await audioCtx.decodeAudioData(bufferCopy);
        } catch {
          try {
            const decode = await import('audio-decode');
            decodedAudioBuffer = await decode.default(bufferCopy);
          } catch {
            console.error('Could not decode audio');
            return;
          }
        }
        const source = audioCtx.createBufferSource();
        source.buffer = decodedAudioBuffer;
        source.connect(gainNode);
        return source;
      }),
    )
  ).filter(Boolean) as AudioBufferSourceNode[];

  return {audioCtx, audioSources};
}

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
    getTextureForNote(
      noteType: EventType,
      modifiers: DrumModifiers | GuitarModifiers,
    ) {
      if (isDrums) {
        switch (noteType) {
          case EventType.kick:
            return kickMaterial;
          case EventType.red:
            return tomTextures.red;
          case EventType.green:
            return tomTextures.green;
          case EventType.orange:
            throw new Error('should not have an orange note');
          case EventType.greenTomOrCymbalMarker:
            return cymbalTextures.green;
          case EventType.blue:
            return tomTextures.blue;
          case EventType.blueTomOrCymbalMarker:
            return cymbalTextures.blue;
          case EventType.yellow:
            return tomTextures.yellow;
          case EventType.yellowTomOrCymbalMarker:
            return cymbalTextures.yellow;
          default:
            throw new Error(`Invalid sprite requested: ${noteType}`);
        }
      } else {
        const guitarModifiers = modifiers as GuitarModifiers;

        const textures = guitarModifiers.isTap
          ? strumTexturesTap
          : guitarModifiers.isForce
          ? strumTexturesHopo
          : strumTextures;
        switch (noteType) {
          case EventType.open:
            return openMaterial;
          case EventType.green:
            return textures[0];
          case EventType.red:
            return textures[1];
          case EventType.yellow:
            return textures[2];
          case EventType.blue:
            return textures[3];
          case EventType.orange:
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

function normalizeDrumEvents(
  events: Map<EventType, number>,
  format: TrackParser['format'],
) {
  // Normalize weirdness
  // If orange, change to green cymbal
  // orange comes from 5 lane charts
  // Possible bug: I have no idea what happens if there's a green and an orange in a 5
  // lane chart

  /*
  5-lane Chart	Conversion
Red	Red
Yellow	Yellow cymbal
Blue	Blue tom
Orange	Green cymbal
Green	Green tom
Orange + Green	G cym + B tom
  */

  if (events.has(EventType.orange)) {
    events.set(EventType.green, events.get(EventType.orange)!);
    events.delete(EventType.orange);
  }

  // I've been told that on mid charts, tomOrCymbal marker is tom, and on chart charts it's cymbal
  if (format == 'mid') {
    if (events.has(EventType.orange)) {
      const orangeLength = events.get(EventType.orange)!;
      events.set(EventType.green, orangeLength);
      events.delete(EventType.greenTomOrCymbalMarker);
      events.delete(EventType.orange);
    }

    if (
      events.has(EventType.yellow) &&
      events.has(EventType.yellowTomOrCymbalMarker)
    ) {
      events.delete(EventType.yellowTomOrCymbalMarker);
    } else if (events.has(EventType.yellowTomOrCymbalMarker)) {
      events.set(
        EventType.yellow,
        events.get(EventType.yellowTomOrCymbalMarker)!,
      );
      events.delete(EventType.yellowTomOrCymbalMarker);
    } else if (events.has(EventType.yellow)) {
      events.set(
        EventType.yellowTomOrCymbalMarker,
        events.get(EventType.yellow)!,
      );
      events.delete(EventType.yellow);
    }

    if (
      events.has(EventType.green) &&
      events.has(EventType.greenTomOrCymbalMarker)
    ) {
      events.delete(EventType.greenTomOrCymbalMarker);
    } else if (events.has(EventType.greenTomOrCymbalMarker)) {
      events.set(
        EventType.green,
        events.get(EventType.greenTomOrCymbalMarker)!,
      );
      events.delete(EventType.greenTomOrCymbalMarker);
    } else if (events.has(EventType.green)) {
      events.set(
        EventType.greenTomOrCymbalMarker,
        events.get(EventType.green)!,
      );
      events.delete(EventType.green);
    }

    if (
      events.has(EventType.blue) &&
      events.has(EventType.blueTomOrCymbalMarker)
    ) {
      events.delete(EventType.blueTomOrCymbalMarker);
    } else if (events.has(EventType.blueTomOrCymbalMarker)) {
      events.set(EventType.blue, events.get(EventType.blueTomOrCymbalMarker)!);
      events.delete(EventType.blueTomOrCymbalMarker);
    } else if (events.has(EventType.blue)) {
      events.set(EventType.blueTomOrCymbalMarker, events.get(EventType.blue)!);
      events.delete(EventType.blue);
    }
  } else {
    if (events.has(EventType.orange)) {
      const orangeLength = events.get(EventType.orange)!;
      events.set(EventType.green, orangeLength);
      events.delete(EventType.orange);
    }

    if (
      events.has(EventType.yellow) &&
      events.has(EventType.yellowTomOrCymbalMarker)
    ) {
      events.delete(EventType.yellow);
    }

    if (
      events.has(EventType.green) &&
      events.has(EventType.greenTomOrCymbalMarker)
    ) {
      events.delete(EventType.green);
    }

    if (
      events.has(EventType.blue) &&
      events.has(EventType.blueTomOrCymbalMarker)
    ) {
      events.delete(EventType.blue);
    }
  }
}

async function generateNoteHighway(
  textureLoader: THREE.TextureLoader,
  instrument: Instrument,
  format: TrackParser['format'],
  highwaySpeed: number,
  clippingPlanes: THREE.Plane[],
  groupedNotes: GroupedTrackEvent[],
): Promise<THREE.Group> {
  const highwayGroups = new THREE.Group();

  const {getTextureForNote} = await loadNoteTextures(textureLoader, instrument);

  for (const group of groupedNotes) {
    const time = group.time;
    const events = new Map<EventType, number>(
      group.events.map(event => [event.type, event.length]),
    );

    const notesGroup = new THREE.Group();
    notesGroup.position.y = (time / 1000) * highwaySpeed - 1;
    highwayGroups.add(notesGroup);

    // Calculate modifiers
    if (instrument == 'drums') {
      normalizeDrumEvents(events, format);

      for (const event of events.keys()) {
        if (event === EventType.kick) {
          const kickScale = 0.045;
          const sprite = new THREE.Sprite(getTextureForNote(event, {}));
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
        }

        const lane =
          event == EventType.red
            ? 0
            : event == EventType.yellow ||
              event == EventType.yellowTomOrCymbalMarker
            ? 1
            : event == EventType.blue ||
              event == EventType.blueTomOrCymbalMarker
            ? 2
            : event == EventType.green ||
              event == EventType.greenTomOrCymbalMarker ||
              event == EventType.orange
            ? 3
            : -1;

        if (lane != -1) {
          const noteXPosition = calculateNoteXOffset(instrument, lane);
          const sprite = new THREE.Sprite(getTextureForNote(event, {}));
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
    } else {
      const modifiers = {
        isTap: events.has(EventType.tap),
        isForce: events.has(EventType.force),
        isStarPower: events.has(EventType.starPower),
      };

      // Remove the modifier events, what's left should be notes
      events.delete(EventType.tap);
      events.delete(EventType.force);
      events.delete(EventType.starPower);

      for (const event of events.keys()) {
        if (event == EventType.open) {
          const openScale = 0.11;
          const sprite = new THREE.Sprite(getTextureForNote(event, {}));
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
            event == EventType.green
              ? 0
              : event == EventType.red
              ? 1
              : event == EventType.yellow
              ? 2
              : event == EventType.blue
              ? 3
              : event == EventType.orange
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
              getTextureForNote(event, modifiers),
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
            const length = events.get(event)!;
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
