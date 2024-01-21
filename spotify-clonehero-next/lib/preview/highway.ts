import {RefObject} from 'react';
import * as THREE from 'three';
import {ChartFile, NoteEvent} from './interfaces';

const noteTextures: Array<THREE.SpriteMaterial> = [];
const noteTexturesHopo: Array<THREE.SpriteMaterial> = [];

type NoteObject = {
  object: THREE.Object3D;
  note: NoteEvent;
};

let startTime = Date.now();

let globalScene: THREE.Scene | null = null;

export type HighwaySettings = {
  highwaySpeed: number;
};

export const setupRenderer = async (
  chart: ChartFile,
  ref: RefObject<HTMLDivElement>,
  audioRef: RefObject<HTMLAudioElement>,
  settings: HighwaySettings,
) => {
  const width = ref.current?.offsetWidth ?? window.innerWidth;
  const height = ref.current?.offsetHeight ?? window.innerHeight;

  console.log('setupRenderer');
  const camera = new THREE.PerspectiveCamera(90, width / height, 0.01, 10);
  camera.position.z = 0.8;
  camera.position.y = -1.3;
  camera.rotation.x = THREE.MathUtils.degToRad(60);

  const scene = new THREE.Scene();

  const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const material = new THREE.MeshNormalMaterial();

  const renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.setSize(width, height);
  renderer.localClippingEnabled = true;

  ref.current?.children.item(0)?.remove();
  ref.current?.appendChild(renderer.domElement);

  const textureLoader = new THREE.TextureLoader();

  // await [0, 1, 2, 3, 4].forEach(async num => {
  //   noteTextures.push(
  //     new THREE.SpriteMaterial({
  //       map: await textureLoader.loadAsync(`/assets/preview/assets/tile000.png`),
  //     })
  //   );
  // });

  for (const num of [0, 1, 2, 3, 4]) {
    noteTextures.push(
      new THREE.SpriteMaterial({
        map: await textureLoader.loadAsync(
          `/assets/preview/assets2/strum${num}.webp`,
        ),
      }),
    );
  }

  for (const num of [0, 1, 2, 3, 4]) {
    noteTexturesHopo.push(
      new THREE.SpriteMaterial({
        map: await textureLoader.loadAsync(
          `/assets/preview/assets2/hopo${num}.webp`,
        ),
      }),
    );
  }

  const openMaterial = new THREE.SpriteMaterial({
    map: await textureLoader.loadAsync(`/assets/preview/assets2/strum5.webp`),
  });

  const highwayBeginningPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1);
  const highwayEndPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.9);

  const clippingPlanes = [highwayBeginningPlane, highwayEndPlane];

  let highwayTexture: THREE.Texture | null;

  {
    textureLoader.load(
      '/assets/preview/assets/highways/highway2.png',
      texture => {
        highwayTexture = texture;

        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;

        texture.repeat.set(1, 2);

        const mat = new THREE.MeshBasicMaterial({map: texture});

        const geometry = new THREE.PlaneGeometry(0.95, 2);
        const material = new THREE.MeshBasicMaterial({
          color: 0xffff00,
          side: THREE.DoubleSide,
        });
        material.clippingPlanes = clippingPlanes;
        const plane = new THREE.Mesh(geometry, mat);
        plane.position.y = -0.1;
        plane.renderOrder = 1;
        scene.add(plane);
      },
    );
  }

  {
    textureLoader.load('/assets/preview/assets/isolated.png', texture => {
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
      const idx = 0;
      // sprite.position.x = -0.5 + scale + ((1 - scale) / 5) * idx;
      sprite.renderOrder = 3;
      scene.add(sprite);
    });
  }

  if (!chart.expertSingle) return;

  // const settings = {
  //   highwaySpeed: 2.5
  // }

  const notes = chart.expertSingle.filter(note => note.type === 'N');

  const noteObjects: Array<NoteObject> = [];

  for (const note of notes) {
    // if (note.fret > 4) continue;

    const SCALE = 0.105;
    const NOTE_SPAN_WIDTH = 0.99;

    const group = new THREE.Group();
    group.position.x =
      0.035 +
      -(NOTE_SPAN_WIDTH / 2) +
      SCALE +
      ((NOTE_SPAN_WIDTH - SCALE) / 5) * note.fret;

    if (note.fret >= 0 && note.fret <= 4) {
      const sprite = new THREE.Sprite(
        note.hopo ? noteTexturesHopo[note.fret] : noteTextures[note.fret],
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
    } else if (note.fret === 7) {
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

    if (note.duration && note.duration !== 0) {
      let colors = ['#01B11A', '#DD2214', '#DEEB52', '#006CAF', '#F8B272'];

      const mat = new THREE.MeshBasicMaterial({
        color: colors[note.fret],
        side: THREE.DoubleSide,
      });

      mat.clippingPlanes = clippingPlanes;
      mat.depthTest = false;
      mat.transparent = true;

      const geometry = new THREE.PlaneGeometry(
        SCALE * 0.175,
        note.duration * settings.highwaySpeed,
      );
      const plane = new THREE.Mesh(geometry, mat);

      plane.position.z = 0;
      plane.position.y =
        (note.duration! / 2) * settings.highwaySpeed + SCALE / 2;
      // console.log(" note.duration! / 2", note.duration! / 2);
      plane.renderOrder = 2;
      group.add(plane);
    }

    scene.add(group);

    noteObjects.push({object: group, note});
  }

  // scene.add(group);

  const audio = audioRef.current!;
  audio.volume = 0.1;
  audio.onplay = () => {
    startTime = Date.now() - audio.currentTime * 1000;
  };
  audio.play();

  const SYNC_MS = new AudioContext().outputLatency;
  const SYNC_ = SYNC_MS / 1000;

  function animation(time: number) {
    if (!audio.paused) {
      const elapsedTime = (Date.now() - startTime) / 1000 + SYNC_;

      if (highwayTexture) {
        highwayTexture.offset.y = elapsedTime * settings.highwaySpeed - 1;
      }

      for (const {object, note} of noteObjects) {
        let notPast = object.position.y > -1;
        object.position.y =
          (note.time! - elapsedTime) * settings.highwaySpeed - 1;
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

  // return settings;
};
