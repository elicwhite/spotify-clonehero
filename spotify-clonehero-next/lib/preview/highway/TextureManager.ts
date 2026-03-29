import * as THREE from 'three';
import {noteFlags, noteTypes, Instrument} from '@eliwhite/scan-chart';
import {interpretDrumNote, noteTypeToPad} from '../../drum-mapping/noteToInstrument';
import {DRUM_TEXTURE_PATH, SP_FLAG, type Note} from './types';

// ---------------------------------------------------------------------------
// Animated WebP texture support (Chrome-only, graceful fallback)
// ---------------------------------------------------------------------------

/**
 * Check if the ImageDecoder API is available for animated WebP support.
 * This API is available in Chromium-based browsers (Chrome, Edge, Opera).
 */
function isImageDecoderSupported(): boolean {
  return typeof ImageDecoder !== 'undefined';
}

/**
 * Check if animations are supported on this browser.
 * Use this to conditionally enable/disable animation features.
 */
export function areAnimationsSupported(): boolean {
  return isImageDecoderSupported();
}

/**
 * Manages an animated WebP texture using the ImageDecoder API.
 * Pre-decodes all frames during initialization for optimal performance.
 * Falls back to a static texture if ImageDecoder is not supported.
 */
export class AnimatedTexture {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  public texture: THREE.CanvasTexture;
  private frameIndex = 0;
  private frameCount = 0;
  private lastFrameTime = 0;
  private frameDurations: number[] = [];
  /** Pre-decoded frames stored as ImageBitmap for fast synchronous access */
  private frameCache: ImageBitmap[] = [];
  private isAnimated = false;
  private disposed = false;

  private constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  /**
   * Creates an AnimatedTexture from a URL.
   * Uses ImageDecoder for animation if available, otherwise loads as static texture.
   * Pre-decodes all frames during initialization for optimal render performance.
   */
  static async create(
    textureLoader: THREE.TextureLoader,
    url: string,
  ): Promise<AnimatedTexture | THREE.Texture> {
    if (!isImageDecoderSupported()) {
      return loadStaticTexture(textureLoader, url);
    }

    try {
      const response = await fetch(url);
      if (!response.ok || !response.body) {
        throw new Error(`Failed to fetch ${url}`);
      }

      const contentType = response.headers.get('content-type') || 'image/webp';
      const isSupported = await ImageDecoder.isTypeSupported(contentType);
      if (!isSupported) {
        return loadStaticTexture(textureLoader, url);
      }

      const decoder = new ImageDecoder({
        data: response.body,
        type: contentType,
      });

      await decoder.completed;

      const track = decoder.tracks.selectedTrack;
      if (!track) {
        throw new Error('No track found in image');
      }

      const frameCount = track.frameCount;

      // If only one frame, just return a static texture
      if (frameCount <= 1) {
        const result = await decoder.decode({frameIndex: 0});
        const frame = result.image;
        const animTexture = new AnimatedTexture(
          frame.displayWidth,
          frame.displayHeight,
        );
        animTexture.ctx.drawImage(frame, 0, 0);
        animTexture.texture.needsUpdate = true;
        frame.close();
        decoder.close();
        return animTexture.texture;
      }

      // Animated image - pre-decode ALL frames for optimal performance
      const firstResult = await decoder.decode({frameIndex: 0});
      const firstFrame = firstResult.image;
      const animTexture = new AnimatedTexture(
        firstFrame.displayWidth,
        firstFrame.displayHeight,
      );

      // Pre-decode all frames into ImageBitmap cache
      animTexture.frameDurations = [];
      animTexture.frameCache = [];

      for (let i = 0; i < frameCount; i++) {
        try {
          const frameResult = await decoder.decode({frameIndex: i});
          const videoFrame = frameResult.image;

          // Create an ImageBitmap from the VideoFrame for fast synchronous access
          const bitmap = await createImageBitmap(videoFrame);
          animTexture.frameCache.push(bitmap);

          // Duration is in microseconds, convert to milliseconds
          const durationMs = (videoFrame.duration ?? 100000) / 1000;
          animTexture.frameDurations.push(durationMs);
          videoFrame.close();
        } catch {
          animTexture.frameDurations.push(100); // Default 100ms
          // If frame decode fails, reuse the last successful frame
          if (animTexture.frameCache.length > 0) {
            animTexture.frameCache.push(
              animTexture.frameCache[animTexture.frameCache.length - 1],
            );
          }
        }
      }

      // Draw the first frame
      if (animTexture.frameCache.length > 0) {
        animTexture.ctx.drawImage(animTexture.frameCache[0], 0, 0);
        animTexture.texture.needsUpdate = true;
      }

      animTexture.frameCount = animTexture.frameCache.length;
      animTexture.isAnimated = animTexture.frameCount > 1;
      animTexture.lastFrameTime = performance.now();

      // Close the decoder - we no longer need it since all frames are cached
      firstFrame.close();
      decoder.close();

      return animTexture;
    } catch (error) {
      // Fall back to static texture on any error
      console.warn(
        'Failed to load animated texture, falling back to static:',
        error,
      );
      return loadStaticTexture(textureLoader, url);
    }
  }

  /**
   * Updates the texture to the current animation frame based on elapsed time.
   * This method is SYNCHRONOUS for optimal render performance - all frames
   * are pre-decoded during initialization.
   */
  tick(): void {
    if (!this.isAnimated || this.disposed || this.frameCache.length === 0) {
      return;
    }

    const now = performance.now();
    const elapsed = now - this.lastFrameTime;
    const currentFrameDuration = this.frameDurations[this.frameIndex] || 100;

    if (elapsed >= currentFrameDuration) {
      this.frameIndex = (this.frameIndex + 1) % this.frameCount;
      this.lastFrameTime = now;

      // Synchronous frame update from pre-decoded cache
      const frame = this.frameCache[this.frameIndex];
      if (frame) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(frame, 0, 0);
        this.texture.needsUpdate = true;
      }
    }
  }

  /**
   * Disposes of resources used by this animated texture.
   */
  dispose(): void {
    this.disposed = true;
    // Close all cached ImageBitmaps
    for (const bitmap of this.frameCache) {
      bitmap.close();
    }
    this.frameCache = [];
    this.texture.dispose();
  }
}

/** Collection of animated textures that need to be ticked each frame */
export class AnimatedTextureManager {
  private animatedTextures: AnimatedTexture[] = [];

  register(texture: AnimatedTexture | THREE.Texture): void {
    if (texture instanceof AnimatedTexture) {
      this.animatedTextures.push(texture);
    }
  }

  /**
   * Updates all animated textures. Called once per frame in the render loop.
   */
  tick(): void {
    for (const texture of this.animatedTextures) {
      texture.tick();
    }
  }

  dispose(): void {
    for (const texture of this.animatedTextures) {
      texture.dispose();
    }
    this.animatedTextures = [];
  }
}

// ---------------------------------------------------------------------------
// Texture loading helpers
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
 * Loads a static texture from a URL with proper error handling.
 * Used as fallback when ImageDecoder is not available.
 */
async function loadStaticTexture(
  textureLoader: THREE.TextureLoader,
  url: string,
): Promise<THREE.Texture> {
  try {
    const texture = await textureLoader.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  } catch (error) {
    console.warn(`Failed to load static texture from ${url}:`, error);
    return createPlaceholderTexture();
  }
}

/**
 * Loads a texture with proper colorSpace and placeholder fallback.
 * For .webp URLs, attempts to load as an animated texture using ImageDecoder
 * when available (Chromium browsers). Falls back to static on other browsers.
 */
export async function loadTexture(
  textureLoader: THREE.TextureLoader,
  url: string,
  animatedTextureManager?: AnimatedTextureManager,
): Promise<THREE.Texture> {
  // For .webp files, try animated loading if ImageDecoder is available
  if (animatedTextureManager && url.endsWith('.webp') && isImageDecoderSupported()) {
    try {
      const result = await AnimatedTexture.create(textureLoader, url);

      if (result instanceof AnimatedTexture) {
        animatedTextureManager.register(result);
        return result.texture;
      }

      // Static texture returned (single frame or fallback)
      return result;
    } catch (error) {
      console.warn(`Failed to load animated texture from ${url}, falling back to static:`, error);
      // Fall through to static loading
    }
  }

  try {
    const texture = await textureLoader.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  } catch (error) {
    console.warn(`Failed to load texture from ${url}:`, error);
    return createPlaceholderTexture();
  }
}

/**
 * Loads a drum texture variant from static.enchor.us.
 * Falls back to the normal (unflagged) texture on failure,
 * or to a placeholder if even the normal texture fails.
 *
 * Unlike `loadTexture`, this function treats load failures as a fallback
 * to the provided normal texture rather than returning a magenta placeholder.
 */
async function loadDrumTextureWithFallback(
  textureLoader: THREE.TextureLoader,
  variantUrl: string,
  fallbackTexture: THREE.Texture | null,
  animatedTextureManager?: AnimatedTextureManager,
): Promise<THREE.Texture> {
  // For .webp files, try animated loading first
  if (animatedTextureManager && variantUrl.endsWith('.webp') && isImageDecoderSupported()) {
    try {
      const result = await AnimatedTexture.create(textureLoader, variantUrl);
      if (result instanceof AnimatedTexture) {
        animatedTextureManager.register(result);
        return result.texture;
      }
      return result;
    } catch {
      // Fall through to static loading
    }
  }

  try {
    const texture = await textureLoader.loadAsync(variantUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  } catch {
    console.warn(
      `Failed to load drum texture variant ${variantUrl}, using fallback`,
    );
    if (fallbackTexture) return fallbackTexture;
    return createPlaceholderTexture();
  }
}

/** Result type for drum texture loaders: type -> flags -> SpriteMaterial */
type DrumTextureMap = Map<number, Map<number, THREE.SpriteMaterial>>;

async function loadTomTextures(
  textureLoader: THREE.TextureLoader,
  animatedTextureManager?: AnimatedTextureManager,
): Promise<DrumTextureMap> {
  const tomNoteTypes = [noteTypes.redDrum, noteTypes.yellowDrum, noteTypes.blueDrum, noteTypes.greenDrum] as const;
  const dynamicFlags: [number, string][] = [
    [noteFlags.none, ''],
    [noteFlags.ghost, '-ghost'],
    [noteFlags.accent, '-accent'],
  ];
  const spFlags: [number, string][] = [
    [noteFlags.none, ''],
    [SP_FLAG, '-sp'],
  ];

  const result: DrumTextureMap = new Map();

  // First pass: load all normal (no dynamic, no SP) textures for fallback
  const normalTextures = new Map<number, THREE.Texture>();
  await Promise.all(
    tomNoteTypes.map(async (noteType) => {
      const colorName = noteTypeToPad(noteType)!;
      const url = `${DRUM_TEXTURE_PATH}drum-tom-${colorName}.webp`;
      const texture = await loadTexture(textureLoader, url, animatedTextureManager);
      normalTextures.set(noteType, texture);
    }),
  );

  // Second pass: load all variants, falling back to normal on failure
  const promises: Promise<void>[] = [];
  for (const noteType of tomNoteTypes) {
    const colorName = noteTypeToPad(noteType)!;
    const flagMap = new Map<number, THREE.SpriteMaterial>();
    result.set(noteType, flagMap);

    for (const [dynamicFlagKey, dynamicFlagName] of dynamicFlags) {
      for (const [spFlagKey, spFlagName] of spFlags) {
        const combinedFlags = spFlagKey | dynamicFlagKey | noteFlags.tom;
        const variantSuffix = `${dynamicFlagName}${spFlagName}`;
        const url = variantSuffix
          ? `${DRUM_TEXTURE_PATH}drum-tom-${colorName}${variantSuffix}.webp`
          : `${DRUM_TEXTURE_PATH}drum-tom-${colorName}.webp`;
        const fallback = normalTextures.get(noteType)!;

        promises.push(
          loadDrumTextureWithFallback(textureLoader, url, fallback, animatedTextureManager).then(
            texture => {
              flagMap.set(combinedFlags, new THREE.SpriteMaterial({map: texture}));
            },
          ),
        );
      }
    }
  }

  await Promise.all(promises);
  return result;
}

async function loadCymbalTextures(
  textureLoader: THREE.TextureLoader,
  animatedTextureManager?: AnimatedTextureManager,
): Promise<DrumTextureMap> {
  // No red cymbal in pro drums -- only yellow, blue, green
  const cymbalNoteTypes = [noteTypes.yellowDrum, noteTypes.blueDrum, noteTypes.greenDrum] as const;
  const dynamicFlags: [number, string][] = [
    [noteFlags.none, ''],
    [noteFlags.ghost, '-ghost'],
    [noteFlags.accent, '-accent'],
  ];
  const spFlags: [number, string][] = [
    [noteFlags.none, ''],
    [SP_FLAG, '-sp'],
  ];

  const result: DrumTextureMap = new Map();

  // First pass: load normal textures for fallback
  const normalTextures = new Map<number, THREE.Texture>();
  await Promise.all(
    cymbalNoteTypes.map(async (noteType) => {
      const colorName = noteTypeToPad(noteType)!;
      const url = `${DRUM_TEXTURE_PATH}drum-cymbal-${colorName}.webp`;
      const texture = await loadTexture(textureLoader, url, animatedTextureManager);
      normalTextures.set(noteType, texture);
    }),
  );

  // Second pass: load all variants
  const promises: Promise<void>[] = [];
  for (const noteType of cymbalNoteTypes) {
    const colorName = noteTypeToPad(noteType)!;
    const flagMap = new Map<number, THREE.SpriteMaterial>();
    result.set(noteType, flagMap);

    for (const [dynamicFlagKey, dynamicFlagName] of dynamicFlags) {
      for (const [spFlagKey, spFlagName] of spFlags) {
        const combinedFlags = spFlagKey | dynamicFlagKey | noteFlags.cymbal;
        const variantSuffix = `${dynamicFlagName}${spFlagName}`;
        const url = variantSuffix
          ? `${DRUM_TEXTURE_PATH}drum-cymbal-${colorName}${variantSuffix}.webp`
          : `${DRUM_TEXTURE_PATH}drum-cymbal-${colorName}.webp`;
        const fallback = normalTextures.get(noteType)!;

        promises.push(
          loadDrumTextureWithFallback(textureLoader, url, fallback, animatedTextureManager).then(
            texture => {
              flagMap.set(combinedFlags, new THREE.SpriteMaterial({map: texture}));
            },
          ),
        );
      }
    }
  }

  await Promise.all(promises);
  return result;
}

async function loadStrumNoteTextures(
  textureLoader: THREE.TextureLoader,
  animatedTextureManager?: AnimatedTextureManager,
) {
  const noteTextures = [];

  for await (const num of [0, 1, 2, 3, 4]) {
    const texture = await loadTexture(
      textureLoader,
      `/assets/preview/assets2/strum${num}.webp`,
      animatedTextureManager,
    );
    noteTextures.push(
      new THREE.SpriteMaterial({
        map: texture,
      }),
    );
  }

  return noteTextures;
}

async function loadStrumHopoNoteTextures(
  textureLoader: THREE.TextureLoader,
  animatedTextureManager?: AnimatedTextureManager,
) {
  const hopoNoteTextures = [];

  for await (const num of [0, 1, 2, 3, 4]) {
    const texture = await loadTexture(
      textureLoader,
      `/assets/preview/assets2/hopo${num}.webp`,
      animatedTextureManager,
    );
    hopoNoteTextures.push(
      new THREE.SpriteMaterial({
        map: texture,
      }),
    );
  }

  return hopoNoteTextures;
}

async function loadStrumTapNoteTextures(
  textureLoader: THREE.TextureLoader,
  animatedTextureManager?: AnimatedTextureManager,
) {
  const hopoNoteTextures = [];

  for await (const num of [0, 1, 2, 3, 4]) {
    const texture = await loadTexture(
      textureLoader,
      `/assets/preview/assets2/tap${num}.png`,
      animatedTextureManager,
    );
    hopoNoteTextures.push(
      new THREE.SpriteMaterial({
        map: texture,
      }),
    );
  }

  return hopoNoteTextures;
}

/**
 * Loads kick drum textures (normal + SP variant).
 * Returns a Map<flags, SpriteMaterial>.
 */
async function loadKickTextures(
  textureLoader: THREE.TextureLoader,
  animatedTextureManager?: AnimatedTextureManager,
): Promise<Map<number, THREE.SpriteMaterial>> {
  const normalTexture = await loadTexture(
    textureLoader,
    `${DRUM_TEXTURE_PATH}drum-kick.webp`,
    animatedTextureManager,
  );
  const spTexture = await loadDrumTextureWithFallback(
    textureLoader,
    `${DRUM_TEXTURE_PATH}drum-kick-sp.webp`,
    normalTexture,
    animatedTextureManager,
  );

  const result = new Map<number, THREE.SpriteMaterial>();
  result.set(noteFlags.none, new THREE.SpriteMaterial({map: normalTexture}));
  result.set(noteFlags.doubleKick, new THREE.SpriteMaterial({map: normalTexture}));
  result.set(noteFlags.none | SP_FLAG, new THREE.SpriteMaterial({map: spTexture}));
  result.set(noteFlags.doubleKick | SP_FLAG, new THREE.SpriteMaterial({map: spTexture}));
  return result;
}

/**
 * Loads all note textures for the given instrument.
 * Returns a getTextureForNote function that maps a Note to a SpriteMaterial.
 */
export async function loadNoteTextures(
  textureLoader: THREE.TextureLoader,
  instrument: Instrument,
  animatedTextureManager?: AnimatedTextureManager,
) {
  const isDrums = instrument == 'drums';

  let strumTextures: THREE.SpriteMaterial[];
  let strumTexturesHopo: THREE.SpriteMaterial[];
  let strumTexturesTap: THREE.SpriteMaterial[];
  let openMaterial: THREE.SpriteMaterial;

  let tomTextures: DrumTextureMap;
  let cymbalTextures: DrumTextureMap;
  let kickTextures: Map<number, THREE.SpriteMaterial>;

  if (isDrums) {
    [tomTextures, cymbalTextures, kickTextures] = await Promise.all([
      loadTomTextures(textureLoader, animatedTextureManager),
      loadCymbalTextures(textureLoader, animatedTextureManager),
      loadKickTextures(textureLoader, animatedTextureManager),
    ]);
  } else {
    strumTextures = await loadStrumNoteTextures(textureLoader, animatedTextureManager);
    strumTexturesHopo = await loadStrumHopoNoteTextures(textureLoader, animatedTextureManager);
    strumTexturesTap = await loadStrumTapNoteTextures(textureLoader, animatedTextureManager);
    openMaterial = new THREE.SpriteMaterial({
      map: await loadTexture(
        textureLoader,
        `/assets/preview/assets2/strum5.webp`,
        animatedTextureManager,
      ),
    });
  }

  return {
    getTextureForNote(note: Note, {inStarPower}: {inStarPower: boolean}) {
      if (isDrums) {
        const interpreted = interpretDrumNote(note);

        if (interpreted.isKick) {
          // Build lookup flags for kick: preserve doubleKick, add SP if needed
          const lookupFlags =
            (interpreted.flags & noteFlags.doubleKick) | (inStarPower ? SP_FLAG : 0);
          return kickTextures.get(lookupFlags) ?? kickTextures.get(noteFlags.none)!;
        }

        const textureMap = interpreted.isCymbal ? cymbalTextures : tomTextures;
        const typeFlag = interpreted.isCymbal ? noteFlags.cymbal : noteFlags.tom;

        // Build lookup flags: type flag + dynamic (ghost/accent) + SP
        const dynamicFlag = interpreted.dynamic === 'ghost'
          ? noteFlags.ghost
          : interpreted.dynamic === 'accent'
            ? noteFlags.accent
            : noteFlags.none;
        const spFlag = inStarPower ? SP_FLAG : 0;
        const lookupFlags = typeFlag | dynamicFlag | spFlag;

        const flagMap = textureMap.get(interpreted.noteType);
        if (!flagMap) {
          throw new Error(`Invalid sprite requested: ${interpreted.noteType}`);
        }

        // Try exact match first, then fall back without SP, then without dynamic, then plain
        return (
          flagMap.get(lookupFlags) ??
          flagMap.get(typeFlag | dynamicFlag) ??
          flagMap.get(typeFlag | spFlag) ??
          flagMap.get(typeFlag)!
        );
      } else {
        const textures =
          note.flags & noteFlags.tap
            ? strumTexturesTap!
            : note.flags & noteFlags.hopo
              ? strumTexturesHopo!
              : strumTextures!;
        switch (note.type) {
          case noteTypes.open:
            return openMaterial!;
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
