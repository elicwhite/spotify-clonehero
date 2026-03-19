import {RefObject} from 'react';
import * as THREE from 'three';
import {Files, ParsedChart} from './chorus-chart-processing';
import {
  Difficulty,
  Instrument,
  noteFlags,
  noteTypes,
} from '@eliwhite/scan-chart';
import {applyDiscoFlip} from '../drum-mapping/noteToInstrument';
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
const NOTE_SPAN_WIDTH = 0.95;
/** How far ahead (in ms) to render notes beyond the strikeline. */
const HIGHWAY_DURATION_MS = 1500;

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

// ---------------------------------------------------------------------------
// Interpolation helper (maps a value from one range to another)
// ---------------------------------------------------------------------------
function interpolate(
  val: number,
  fromStart: number,
  fromEnd: number,
  toStart: number,
  toEnd: number,
): number {
  return (
    ((val - fromStart) / (fromEnd - fromStart)) * (toEnd - toStart) + toStart
  );
}

// ---------------------------------------------------------------------------
// EventSequence – cursor-based O(1) amortised lookup for visible notes
// ---------------------------------------------------------------------------
type NoteType = Note['type'];

class EventSequence<
  T extends {msTime: number; msLength: number; type?: NoteType},
> {
  /** Contains the closest events before msTime, grouped by type */
  private lastPrecedingEventIndexesOfType = new Map<
    NoteType | undefined,
    number
  >();
  private lastPrecedingEventIndex = -1;

  /** Assumes `events` are already sorted in `msTime` order. */
  constructor(private events: T[]) {}

  /**
   * Returns the index of the earliest event that is active (or starts at)
   * `startMs`. "Active" means the event started before `startMs` but its
   * sustain tail extends past it.
   *
   * On forward playback this is O(1) amortised because the cursor only
   * advances forward. On seek-backward it resets and re-scans (still fast
   * for the typical case).
   */
  getEarliestActiveEventIndex(startMs: number): number {
    // Detect seek-backward: reset cursor
    if (
      this.lastPrecedingEventIndex !== -1 &&
      startMs < this.events[this.lastPrecedingEventIndex].msTime
    ) {
      this.lastPrecedingEventIndexesOfType = new Map<
        NoteType | undefined,
        number
      >();
      this.lastPrecedingEventIndex = -1;
    }

    // Advance cursor forward
    while (
      this.events[this.lastPrecedingEventIndex + 1] &&
      this.events[this.lastPrecedingEventIndex + 1].msTime < startMs
    ) {
      this.lastPrecedingEventIndexesOfType.set(
        this.events[this.lastPrecedingEventIndex + 1].type,
        this.lastPrecedingEventIndex + 1,
      );
      this.lastPrecedingEventIndex++;
    }

    // Find the earliest event whose sustain tail is still active
    let earliestActiveEventIndex: number | null = null;
    for (const [, index] of this.lastPrecedingEventIndexesOfType) {
      if (this.events[index].msTime + this.events[index].msLength > startMs) {
        if (
          earliestActiveEventIndex === null ||
          earliestActiveEventIndex > index
        ) {
          earliestActiveEventIndex = index;
        }
      }
    }

    return earliestActiveEventIndex === null
      ? this.lastPrecedingEventIndex + 1
      : earliestActiveEventIndex;
  }
}

// ---------------------------------------------------------------------------
// Pre-computed note data (created once in prepTrack, no sprites)
// ---------------------------------------------------------------------------

/** Flattened, pre-computed data for a single note. */
interface PreparedNote {
  /** Original note object (needed for getTextureForNote) */
  note: Note;
  /** Time in ms */
  msTime: number;
  /** Sustain length in ms */
  msLength: number;
  /** Pre-computed X position in world space */
  xPosition: number;
  /** Whether this note falls inside a star power section */
  inStarPower: boolean;
  /** True if this is a kick drum note (different scale/center) */
  isKick: boolean;
  /** True if this is an open guitar note (different scale) */
  isOpen: boolean;
  /** Lane index (for sustain colour lookup) — -1 for kick/open */
  lane: number;
}

// ---------------------------------------------------------------------------
// NotesManager – windowed rendering with sprite pool
// ---------------------------------------------------------------------------

class NotesManager {
  private scene: THREE.Scene;
  private instrument: Instrument;
  private highwaySpeed: number;
  private clippingPlanes: THREE.Plane[];

  /** Flattened, sorted array of all notes. */
  private preparedNotes: PreparedNote[] = [];
  /** Cursor for efficient windowed lookup. */
  private noteSequence!: EventSequence<PreparedNote>;

  /** Map from preparedNotes index -> active THREE.Group in the scene. */
  private activeNoteGroups = new Map<number, THREE.Group>();

  /** Pool of idle THREE.Group objects ready for reuse. */
  private groupPool: THREE.Group[] = [];

  /** Pre-loaded shared SpriteMaterial getter. */
  private getTextureForNote!: (
    note: Note,
    opts: {inStarPower: boolean},
  ) => THREE.SpriteMaterial;

  constructor(
    scene: THREE.Scene,
    instrument: Instrument,
    highwaySpeed: number,
    clippingPlanes: THREE.Plane[],
  ) {
    this.scene = scene;
    this.instrument = instrument;
    this.highwaySpeed = highwaySpeed;
    this.clippingPlanes = clippingPlanes;
  }

  /** Load textures and pre-compute note data. No sprites are created yet. */
  async prepare(textureLoader: THREE.TextureLoader, track: Track) {
    const {getTextureForNote} = await loadNoteTextures(
      textureLoader,
      this.instrument,
    );
    this.getTextureForNote = getTextureForNote;

    const isDrums = this.instrument === 'drums';
    const starPowerSections = track.starPowerSections;

    // Build a sorted list of star power section start times for binary search
    const spStarts = starPowerSections.map(s => s.msTime);
    const spEnds = starPowerSections.map(s => s.msTime + s.msLength);

    function inStarPowerSection(time: number): boolean {
      // Binary search: find the last section that starts <= time
      let lo = 0;
      let hi = spStarts.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (spStarts[mid] <= time) {
          idx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return idx >= 0 && time <= spEnds[idx];
    }

    // Flatten all note event groups into a single sorted array
    const prepared: PreparedNote[] = [];

    for (const group of track.noteEventGroups) {
      const time = group[0].msTime;
      const starPower = inStarPowerSection(time);

      for (const note of group) {
        if (isDrums) {
          const {type: discoType} = applyDiscoFlip(note);

          if (discoType === noteTypes.kick) {
            prepared.push({
              note,
              msTime: note.msTime,
              msLength: note.msLength,
              xPosition: 0, // kick has no lane X offset — centered via sprite center
              inStarPower: starPower,
              isKick: true,
              isOpen: false,
              lane: -1,
            });
          } else {
            const lane =
              discoType === noteTypes.redDrum
                ? 0
                : discoType === noteTypes.yellow ||
                    discoType === noteTypes.yellowDrum
                  ? 1
                  : discoType === noteTypes.blue ||
                      discoType === noteTypes.blueDrum
                    ? 2
                    : discoType === noteTypes.green ||
                        discoType === noteTypes.greenDrum ||
                        discoType === noteTypes.orange
                      ? 3
                      : -1;

            if (lane !== -1) {
              prepared.push({
                note,
                msTime: note.msTime,
                msLength: note.msLength,
                xPosition: calculateNoteXOffset(this.instrument, lane),
                inStarPower: starPower,
                isKick: false,
                isOpen: false,
                lane,
              });
            }
          }
        } else {
          // Guitar / bass
          if (note.type === noteTypes.open) {
            prepared.push({
              note,
              msTime: note.msTime,
              msLength: note.msLength,
              xPosition: 0,
              inStarPower: starPower,
              isKick: false,
              isOpen: true,
              lane: -1,
            });
          } else {
            const lane =
              note.type === noteTypes.green
                ? 0
                : note.type === noteTypes.red
                  ? 1
                  : note.type === noteTypes.yellow
                    ? 2
                    : note.type === noteTypes.blue
                      ? 3
                      : note.type === noteTypes.orange
                        ? 4
                        : -1;

            if (lane !== -1) {
              prepared.push({
                note,
                msTime: note.msTime,
                msLength: note.msLength,
                xPosition: calculateNoteXOffset(this.instrument, lane),
                inStarPower: starPower,
                isKick: false,
                isOpen: false,
                lane,
              });
            }
          }
        }
      }
    }

    // Already sorted because noteEventGroups is sorted by time
    this.preparedNotes = prepared;
    this.noteSequence = new EventSequence(prepared);
  }

  /**
   * Called every frame. Adds/removes/repositions sprites so that only notes
   * within the visible time window are in the scene.
   */
  updateDisplayedNotes(currentTimeMs: number) {
    const renderEndTimeMs = currentTimeMs + HIGHWAY_DURATION_MS;
    const noteStartIndex =
      this.noteSequence.getEarliestActiveEventIndex(currentTimeMs);

    let maxNoteIndex = noteStartIndex - 1;

    // Update existing active notes — reposition or remove
    for (const [noteIndex, group] of this.activeNoteGroups) {
      const pn = this.preparedNotes[noteIndex];
      if (
        noteIndex < noteStartIndex ||
        pn.msTime > renderEndTimeMs
      ) {
        // Off-screen — recycle
        this.scene.remove(group);
        this.recycleGroup(group);
        this.activeNoteGroups.delete(noteIndex);
      } else {
        // Still visible — reposition
        group.position.y = this.noteYPosition(pn.msTime, currentTimeMs, renderEndTimeMs);

        // Reposition sustain tail if present
        if (pn.msLength > 0 && group.children.length > 1) {
          const sustainMesh = group.children[1] as THREE.Mesh;
          const sustainWorldHeight = 2 * (pn.msLength / HIGHWAY_DURATION_MS);
          // Update geometry in case HIGHWAY_DURATION_MS or sizing changed
          // (for now it's constant, but the geometry was created with the
          // current value so this is a no-op repositioning)
          sustainMesh.position.y = 0.03 + pn.msLength / HIGHWAY_DURATION_MS;
        }

        if (noteIndex > maxNoteIndex) {
          maxNoteIndex = noteIndex;
        }
      }
    }

    // Add new notes that entered the window
    for (
      let i = maxNoteIndex + 1;
      i < this.preparedNotes.length &&
      this.preparedNotes[i].msTime < renderEndTimeMs;
      i++
    ) {
      // Skip if already active (shouldn't happen, but be safe)
      if (this.activeNoteGroups.has(i)) continue;

      const pn = this.preparedNotes[i];
      const noteGroup = this.acquireGroup();

      // Configure the sprite
      const material = this.getTextureForNote(pn.note, {
        inStarPower: pn.inStarPower,
      });
      const sprite = this.ensureSprite(noteGroup, material);

      if (pn.isKick) {
        const kickScale = 0.045;
        sprite.center.set(0.62, -0.5);
        const aspectRatio =
          sprite.material.map!.image.width / sprite.material.map!.image.height;
        sprite.scale.set(kickScale * aspectRatio, kickScale, kickScale);
        sprite.renderOrder = 1;
        noteGroup.position.x = 0;
      } else if (pn.isOpen) {
        const openScale = 0.11;
        sprite.center.set(0.5, 0);
        const aspectRatio =
          sprite.material.map!.image.width / sprite.material.map!.image.height;
        sprite.scale.set(openScale * aspectRatio, openScale, openScale);
        sprite.renderOrder = 4;
        noteGroup.position.x = 0;
      } else {
        sprite.center.set(0.5, 0);
        const aspectRatio =
          sprite.material.map!.image.width / sprite.material.map!.image.height;
        sprite.scale.set(SCALE * aspectRatio, SCALE, SCALE);
        sprite.renderOrder = 4;
        noteGroup.position.x = pn.xPosition;
      }

      sprite.position.x = 0;
      sprite.position.z = 0;
      sprite.material.clippingPlanes = this.clippingPlanes;
      sprite.material.depthTest = false;
      sprite.material.transparent = true;

      noteGroup.position.y = this.noteYPosition(pn.msTime, currentTimeMs, renderEndTimeMs);
      noteGroup.position.z = 0;

      // Sustain tail (guitar only, non-kick, non-open with length > 0)
      if (pn.msLength > 0 && !pn.isKick && pn.lane >= 0) {
        const sustainMesh = this.ensureSustain(noteGroup, pn);
        sustainMesh.visible = true;
      } else {
        // Hide sustain if this pooled group had one from a previous use
        if (noteGroup.children.length > 1) {
          noteGroup.children[1].visible = false;
        }
      }

      this.activeNoteGroups.set(i, noteGroup);
      this.scene.add(noteGroup);
    }
  }

  // -----------------------------------------------------------------------
  // Coordinate helpers
  // -----------------------------------------------------------------------

  /**
   * Computes the world-space Y for a note.
   *
   * IMPORTANT: This must produce the same Y that the HighwayEditor overlay
   * computes via `((ms - elapsedMs) / 1000) * highwaySpeed - 1`. We use
   * interpolate() for clarity but the algebra is identical:
   *
   *   interpolate(noteMs, currentMs, currentMs + HIGHWAY_DURATION_MS, -1, 1)
   *   = ((noteMs - currentMs) / HIGHWAY_DURATION_MS) * 2 - 1
   *
   * However the HighwayEditor uses:
   *   ((noteMs - currentMs) / 1000) * highwaySpeed - 1
   *
   * For these to agree we need:
   *   ((noteMs - currentMs) / HIGHWAY_DURATION_MS) * 2 = ((noteMs - currentMs) / 1000) * highwaySpeed
   *   => 2 / HIGHWAY_DURATION_MS = highwaySpeed / 1000
   *   => HIGHWAY_DURATION_MS = 2000 / highwaySpeed
   *
   * With highwaySpeed = 1.5, HIGHWAY_DURATION_MS = 1333.33.
   *
   * But we want HIGHWAY_DURATION_MS = 1500 for the buffer beyond clipping.
   * So instead of using interpolate(-1, 1) we directly compute using
   * highwaySpeed, matching the HighwayEditor formula exactly.
   */
  private noteYPosition(
    noteMs: number,
    _currentMs: number,
    _renderEndMs: number,
  ): number {
    return ((noteMs - _currentMs) / 1000) * this.highwaySpeed - 1;
  }

  // -----------------------------------------------------------------------
  // Sprite pool management
  // -----------------------------------------------------------------------

  /** Get an idle group from the pool or create a new one. */
  private acquireGroup(): THREE.Group {
    const group = this.groupPool.pop();
    if (group) {
      return group;
    }
    return new THREE.Group();
  }

  /** Return a group to the pool after removing it from the scene. */
  private recycleGroup(group: THREE.Group) {
    // Don't dispose materials/geometries — they're shared or will be reused.
    // Just hide sustain children and push back.
    for (let i = 1; i < group.children.length; i++) {
      group.children[i].visible = false;
    }
    this.groupPool.push(group);
  }

  /**
   * Ensures the group has a Sprite as its first child, configured with
   * the given material. Reuses existing sprite if present.
   */
  private ensureSprite(
    group: THREE.Group,
    material: THREE.SpriteMaterial,
  ): THREE.Sprite {
    if (group.children.length > 0 && group.children[0] instanceof THREE.Sprite) {
      const sprite = group.children[0] as THREE.Sprite;
      sprite.material = material;
      sprite.visible = true;
      return sprite;
    }
    const sprite = new THREE.Sprite(material);
    group.add(sprite);
    return sprite;
  }

  /**
   * Ensures the group has a sustain-tail mesh as its second child.
   * Creates one if needed, or reconfigures the existing one.
   */
  private ensureSustain(
    group: THREE.Group,
    pn: PreparedNote,
  ): THREE.Mesh {
    const sustainWorldHeight = 2 * (pn.msLength / HIGHWAY_DURATION_MS);
    const color =
      pn.lane >= 0 && pn.lane < GUITAR_LANE_COLORS.length
        ? GUITAR_LANE_COLORS[pn.lane]
        : '#FFFFFF';
    const sustainWidth = pn.isOpen ? SCALE * 5 : SCALE * 0.3;

    if (
      group.children.length > 1 &&
      group.children[1] instanceof THREE.Mesh
    ) {
      const mesh = group.children[1] as THREE.Mesh<
        THREE.PlaneGeometry,
        THREE.MeshBasicMaterial
      >;
      // Reconfigure geometry (dispose old, create new)
      mesh.geometry.dispose();
      mesh.geometry = new THREE.PlaneGeometry(sustainWidth, sustainWorldHeight);
      (mesh.material as THREE.MeshBasicMaterial).color.set(color);
      mesh.position.y = 0.03 + pn.msLength / HIGHWAY_DURATION_MS;
      mesh.visible = true;
      return mesh;
    }

    const mat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
    });
    mat.clippingPlanes = this.clippingPlanes;
    mat.depthTest = false;
    mat.transparent = true;

    const geometry = new THREE.PlaneGeometry(sustainWidth, sustainWorldHeight);
    const plane = new THREE.Mesh(geometry, mat);
    plane.position.z = 0;
    plane.position.y = 0.03 + pn.msLength / HIGHWAY_DURATION_MS;
    plane.renderOrder = 2;
    group.add(plane);
    return plane;
  }
}

// ---------------------------------------------------------------------------
// setupRenderer (public API – signature unchanged)
// ---------------------------------------------------------------------------

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
      const {scene, notesManager, highwayTexture} = await trackPromise;

      await startRender(
        scene,
        highwayTexture,
        notesManager,
        metadata.song_length || 60 * 5 * 1000,
      );
    },

    destroy: () => {
      console.log('Tearing down the renderer');
      window.removeEventListener('resize', onResize, false);
      renderer.setAnimationLoop(null);
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
    /** Expose the camera for overlay coordinate mapping (unprojection). */
    getCamera() {
      return camera;
    },
    /** Expose the highway speed constant. */
    getHighwaySpeed() {
      return highwaySpeed;
    },
  };

  return methods;

  async function prepTrack(scene: THREE.Scene, track: Track) {
    const {highwayTexture} = await initPromise;

    if (track.instrument === 'drums') {
      scene.add(createDrumHighway(highwayTexture));
      scene.add(await loadAndCreateDrumHitBox(textureLoader));
    } else {
      scene.add(createHighway(highwayTexture));
      scene.add(await loadAndCreateHitBox(textureLoader));
    }

    const notesManager = new NotesManager(
      scene,
      track.instrument,
      highwaySpeed,
      clippingPlanes,
    );
    await notesManager.prepare(textureLoader, track);

    return {
      scene,
      highwayTexture,
      notesManager,
    };
  }

  async function startRender(
    scene: THREE.Scene,
    highwayTexture: THREE.Texture,
    notesManager: NotesManager,
    songLength: number,
  ) {
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

          // Scroll the highway background texture
          const scrollPosition = -1 * (elapsedTime / 1000) * highwaySpeed;
          if (highwayTexture) {
            highwayTexture.offset.y = -1 * scrollPosition;
          }

          // Update windowed note rendering
          notesManager.updateDisplayedNotes(elapsedTime);
        }
      }

      renderer.render(scene, camera);
    }
  }
};

// ---------------------------------------------------------------------------
// Texture loading helpers (unchanged)
// ---------------------------------------------------------------------------

/**
 * Creates a placeholder texture (magenta square) for missing textures.
 * This ensures notes always render even if texture loading fails.
 */
function createPlaceholderTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FF00FF';
  ctx.fillRect(0, 0, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Loads a texture with proper colorSpace and placeholder fallback.
 */
async function loadTexture(
  textureLoader: THREE.TextureLoader,
  url: string,
): Promise<THREE.Texture> {
  try {
    const texture = await textureLoader.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  } catch (error) {
    console.warn(`Failed to load texture from ${url}:`, error);
    return createPlaceholderTexture();
  }
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
      map: await loadTexture(
        textureLoader,
        `/assets/preview/assets2/drum-kick.webp`,
      ),
    });
  } else {
    strumTextures = await loadStrumNoteTextures(textureLoader);
    strumTexturesHopo = await loadStrumHopoNoteTextures(textureLoader);
    strumTexturesTap = await loadStrumTapNoteTextures(textureLoader);
    openMaterial = new THREE.SpriteMaterial({
      map: await loadTexture(
        textureLoader,
        `/assets/preview/assets2/strum5.webp`,
      ),
    });
  }

  return {
    getTextureForNote(note: Note, {inStarPower}: {inStarPower: boolean}) {
      if (isDrums) {
        // Apply disco flip: swaps red↔yellow and tom↔cymbal flags for disco notes
        const {type, flags} = applyDiscoFlip(note);

        if (type == noteTypes.greenDrum && flags & noteFlags.cymbal) {
          return cymbalTextures.green;
        } else if (type == noteTypes.blueDrum && flags & noteFlags.cymbal) {
          return cymbalTextures.blue;
        } else if (type == noteTypes.yellowDrum && flags & noteFlags.cymbal) {
          return cymbalTextures.yellow;
        } else if (type == noteTypes.kick) {
          return kickMaterial;
        } else if (type == noteTypes.redDrum) {
          // Red is always tom in pro drums — ignore cymbal flag
          return tomTextures.red;
        } else if (type == noteTypes.greenDrum) {
          return tomTextures.green;
        } else if (type == noteTypes.blueDrum) {
          return tomTextures.blue;
        } else if (type == noteTypes.yellowDrum) {
          return tomTextures.yellow;
        } else {
          throw new Error(`Invalid sprite requested: ${type}`);
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
    const texture = await loadTexture(
      textureLoader,
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
    const texture = await loadTexture(
      textureLoader,
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
    const texture = await loadTexture(
      textureLoader,
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
      const texture = await loadTexture(
        textureLoader,
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
      const texture = await loadTexture(
        textureLoader,
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
  const texture = await loadTexture(
    textureLoader,
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
  const texture = await loadTexture(
    textureLoader,
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
  const texture = await loadTexture(
    textureLoader,
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
