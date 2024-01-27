import {RefObject} from 'react';
import * as THREE from 'three';
import {ChartParser} from './chart-parser';
import {MidiParser} from './midi-parser';
import {Difficulty, EventType, Instrument, TrackEvent} from 'scan-chart-web';
import {text} from 'stream/consumers';

type NoteObject = {
  object: THREE.Object3D;
  note: TrackEvent;
};

export type SelectedTrack = {
  instrument: Instrument;
  difficulty: Difficulty;
};

export type Song = {};

export type HighwaySettings = {
  highwaySpeed: number;
};

export const setupRenderer = (
  chart: ChartParser | MidiParser,
  sizingRef: RefObject<HTMLDivElement>,
  ref: RefObject<HTMLDivElement>,
  audioFiles: File[],
  selectedTrack: SelectedTrack,
  settings: HighwaySettings,
) => {
  console.log('Playing Preview');
  let startTime = Date.now();
  const camera = new THREE.PerspectiveCamera(90, 1 / 1, 0.01, 10);
  camera.position.z = 0.8;
  camera.position.y = -1.3;
  camera.rotation.x = THREE.MathUtils.degToRad(60);

  const scene = new THREE.Scene();

  // const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  // const material = new THREE.MeshNormalMaterial();

  const renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.localClippingEnabled = true;

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

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.suspend();

  async function sizingRefClicked() {
    if (audioCtx.state === 'running') {
      await audioCtx.suspend();
      console.log('Paused at', audioCtx.currentTime * 1000);
    } else if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
      startTime = Date.now() - audioCtx.currentTime * 1000;
    }
  }

  sizingRef.current?.addEventListener('click', sizingRefClicked);

  run();

  return {
    destroy: () => {
      console.log('Tearing down the renderer');
      window.removeEventListener('resize', onResize, false);
      audioCtx.close();
      sizingRef.current?.removeEventListener('click', sizingRefClicked);
    },
  };

  async function run() {
    const textureLoader = new THREE.TextureLoader();

    const noteTextures = await loadNoteTextures(textureLoader);
    const noteTexturesHopo = await loadHopoNoteTextures(textureLoader);

    const openMaterial = new THREE.SpriteMaterial({
      map: await textureLoader.loadAsync(`/assets/preview/assets2/strum5.webp`),
    });

    const highwayBeginningPlane = new THREE.Plane(
      new THREE.Vector3(0, 1, 0),
      1,
    );
    const highwayEndPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.9);
    const clippingPlanes = [highwayBeginningPlane, highwayEndPlane];

    const highwayTexture: THREE.Texture =
      await getHighwayTexture(textureLoader);

    const track = chart.trackParsers.find(
      parser =>
        parser.instrument == selectedTrack.instrument &&
        parser.difficulty == selectedTrack.difficulty,
    )!;
    if (track == null) {
      console.log(
        'No track found for',
        selectedTrack,
        'Only found',
        chart.trackParsers.map(
          trackParser =>
            `${trackParser.instrument} - ${trackParser.difficulty}`,
        ),
      );

      return;
    }

    if (track.instrument == 'drums') {
      scene.add(createDrumHighway(highwayTexture, clippingPlanes));
      scene.add(await loadAndCreateDrumHitBox(textureLoader));
    } else {
      scene.add(createHighway(highwayTexture, clippingPlanes));
      scene.add(await loadAndCreateHitBox(textureLoader));
    }

    const notes = track.notes;

    const noteObjects: Array<NoteObject> = [];

    for (const note of notes) {
      const fret =
        note.type == EventType.green
          ? 0
          : note.type == EventType.red
          ? 1
          : note.type == EventType.yellow
          ? 2
          : note.type == EventType.blue
          ? 3
          : note.type == EventType.orange
          ? 4
          : note.type == EventType.open
          ? 7
          : -1;
      // if (note.fret > 4) continue;

      const SCALE = 0.105;
      const NOTE_SPAN_WIDTH = 0.99;

      const group = new THREE.Group();

      const leftOffset = track.instrument == 'drums' ? 0.015 : 0.035;

      group.position.x =
        leftOffset +
        -(NOTE_SPAN_WIDTH / 2) +
        SCALE +
        ((NOTE_SPAN_WIDTH - SCALE) / 5) * fret;

      if (fret >= 0 && fret <= 4) {
        const sprite = new THREE.Sprite(
          note.type === EventType.tap
            ? noteTexturesHopo[fret]
            : noteTextures[fret],
        );
        sprite.center = new THREE.Vector2(0.5, 0);
        const aspectRatio =
          sprite.material.map!.image.width / sprite.material.map!.image.height;
        sprite.scale.set(SCALE * aspectRatio, SCALE, SCALE);
        sprite.position.z = 0;
        sprite.material.clippingPlanes = clippingPlanes;
        sprite.material.depthTest = false;
        sprite.material.transparent = true;
        sprite.renderOrder = 4;
        group.add(sprite);
      } else if (note.type === EventType.open) {
        const openScale = 0.11;
        const sprite = new THREE.Sprite(openMaterial);
        sprite.center = new THREE.Vector2(0.5, 0);
        const aspectRatio =
          sprite.material.map!.image.width / sprite.material.map!.image.height;
        sprite.scale.set(openScale * aspectRatio, openScale, openScale);
        sprite.position.x = -0.9;
        sprite.position.z = 0;
        sprite.material.clippingPlanes = clippingPlanes;
        sprite.material.depthTest = false;
        sprite.material.transparent = true;
        sprite.renderOrder = 4;
        group.add(sprite);
      }

      // const myText = new SpriteText(`${note.tick}`);
      // myText.position.z = 0.2;
      // myText.scale.set(SCALE * 0.5, SCALE * 0.5, SCALE * 0.5);
      // group.add(myText);

      if (note.length && note.length !== 0) {
        let colors = ['#01B11A', '#DD2214', '#DEEB52', '#006CAF', '#F8B272'];

        const mat = new THREE.MeshBasicMaterial({
          color: colors[fret],
          side: THREE.DoubleSide,
        });

        mat.clippingPlanes = clippingPlanes;
        mat.depthTest = false;
        mat.transparent = true;

        const geometry = new THREE.PlaneGeometry(
          SCALE * 0.175,
          (note.length / 1000) * settings.highwaySpeed,
        );
        const plane = new THREE.Mesh(geometry, mat);

        plane.position.z = 0;
        plane.position.y =
          (note.length! / 1000 / 2) * settings.highwaySpeed + SCALE / 2;
        plane.renderOrder = 2;
        group.add(plane);
      }

      scene.add(group);

      noteObjects.push({object: group, note});
    }

    const songLength = chart.notesData.length;

    // scene.add(group);
    const sources = await Promise.all(
      audioFiles.map(async audioFile => {
        if (audioCtx.state === 'closed') {
          // Can happen if cleaned up before setup is done
          return;
        }
        const arrayBuffer = await audioFile.arrayBuffer();
        const decodedAudioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const source = audioCtx.createBufferSource();
        source.buffer = decodedAudioBuffer;
        source.connect(audioCtx.destination);
        return source;
      }),
    );

    sources.filter(Boolean).forEach(source => {
      source!.start();
    });

    const SYNC_MS = new AudioContext().outputLatency * 1000;

    function animation(time: number) {
      if (audioCtx.state === 'running') {
        const elapsedTime = Date.now() - startTime + SYNC_MS;
        if (elapsedTime > songLength) {
          renderer.setAnimationLoop(null);
          audioCtx.close();
        }

        if (highwayTexture) {
          highwayTexture.offset.y =
            (elapsedTime / 1000) * settings.highwaySpeed - 1;
        }

        for (const {object, note} of noteObjects) {
          let notPast = object.position.y > -1;
          object.position.y =
            ((note.time - elapsedTime) / 1000) * settings.highwaySpeed - 1;
          // console.log('y', object.position.y, note.time, elapsedTime);
          if (notPast && object.position.y <= -1) {
            // console.log("note", note.tick);
          }

          for (const child of object.children) {
            if (child instanceof THREE.Sprite) {
              // object.visible = object.position.y > -1;
            }
          }

          // if (object.position.y <= -1) {
          //   for (const child of object.children) {
          //     if (child instanceof THREE.Sprite) {
          //       object.remove(child);

          //     }
          //   }
          //   // scene.remove();
          // } e
        }
      }

      renderer.render(scene, camera);
    }

    renderer.setAnimationLoop(animation);
  }
};

async function loadNoteTextures(textureLoader: THREE.TextureLoader) {
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

async function getHighwayTexture(textureLoader: THREE.TextureLoader) {
  const texture = await textureLoader.loadAsync(
    '/assets/preview/assets/highways/highway2.png',
  );

  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;

  texture.repeat.set(1, 2);
  return texture;
}

function createHighway(
  highwayTexture: THREE.Texture,
  clippingPlanes: THREE.Plane[],
) {
  const mat = new THREE.MeshBasicMaterial({map: highwayTexture});

  const geometry = new THREE.PlaneGeometry(0.95, 2);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    side: THREE.DoubleSide,
  });
  material.clippingPlanes = clippingPlanes;
  const plane = new THREE.Mesh(geometry, mat);
  plane.position.y = -0.1;
  plane.renderOrder = 1;
  return plane;
}

function createDrumHighway(
  highwayTexture: THREE.Texture,
  clippingPlanes: THREE.Plane[],
) {
  const mat = new THREE.MeshBasicMaterial({map: highwayTexture});

  const geometry = new THREE.PlaneGeometry(0.8, 2);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    side: THREE.DoubleSide,
  });
  material.clippingPlanes = clippingPlanes;
  const plane = new THREE.Mesh(geometry, mat);
  plane.position.y = -0.1;
  plane.renderOrder = 1;
  return plane;
}

async function loadHopoNoteTextures(textureLoader: THREE.TextureLoader) {
  const hopoNoteTextures = [];

  for await (const num of [0, 1, 2, 3, 4]) {
    const texture = await textureLoader.loadAsync(
      `/assets/preview/assets2/strum${num}.webp`,
    );
    hopoNoteTextures.push(
      new THREE.SpriteMaterial({
        map: texture,
      }),
    );
  }

  return hopoNoteTextures;
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
  // sprite.rotation.x = 45;
  // const scale = 0.15;
  // sprite.scale.set(scale, scale, scale);
  sprite.position.y = -1;
  // const idx = 0;
  // sprite.position.x = -0.5 + scale + ((1 - scale) / 5) * idx;
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
  // sprite.rotation.x = 45;
  // const scale = 0.15;
  // sprite.scale.set(scale, scale, scale);
  sprite.position.y = -1;
  // const idx = 0;
  // sprite.position.x = -0.5 + scale + ((1 - scale) / 5) * idx;
  sprite.renderOrder = 3;

  return sprite;
}
