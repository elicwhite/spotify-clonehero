/**
 * Service and instrument marks, drawn from the app's own artwork.
 *
 * AppleMusicMark, InstrumentIcon and Gem load files from the app's
 * `public/assets` through `publicUrl`. A film serves that folder under its
 * own public dir at `public/product` (a link to the app's folder, the same
 * one the product highway reads its art from); pass `assets` if it is
 * somewhere else. Without it the image fails to load and the render stops
 * with its path. SpotifyMark is the app's own vector (the path in
 * components/SpotifyIcon.tsx) and needs nothing served.
 */
import type {CSSProperties} from 'react';
import {Img} from 'remotion';
import {useFormat} from '../format';
import {PRODUCT_ASSETS_PATH} from '../highway/assetsPath';
import {publicUrl} from '../load';
import {color} from './tokens';

/** A file of the app's `public/assets`, served at `root` under the film's public dir. */
const appAsset = (root: string, file: string): string =>
  publicUrl(`${root.replace(/\/+$/, '')}/${file}`);

export interface SpotifyMarkProps {
  /** px (default 32 reference px; Spotify's floor is 21 px at 1080). */
  size?: number;
  /**
   * 'green' only on black or white backgrounds; 'white' and 'black' (the
   * one-colour icons) everywhere else. Never recoloured, never on a tile.
   */
  variant?: 'green' | 'white' | 'black';
  style?: CSSProperties;
}

const SPOTIFY_FILL = {
  green: color.spotify,
  white: '#ffffff',
  black: '#000000',
} as const;

/** The official Spotify icon, the same path the app draws. */
export const SpotifyMark: React.FC<SpotifyMarkProps> = ({
  size,
  variant = 'green',
  style,
}) => {
  const {unit} = useFormat();
  const px = size ?? 32 * unit;
  return (
    <svg
      viewBox="0 0 2931 2931"
      width={px}
      height={px}
      style={{flexShrink: 0, ...style}}
      aria-hidden>
      <path
        fill={SPOTIFY_FILL[variant]}
        d="M1465.5 0C656.1 0 0 656.1 0 1465.5S656.1 2931 1465.5 2931 2931 2274.9 2931 1465.5C2931 656.2 2274.9.1 1465.5 0zm672.1 2113.6c-26.3 43.2-82.6 56.7-125.6 30.4-344.1-210.3-777.3-257.8-1287.4-141.3-49.2 11.3-98.2-19.5-109.4-68.7-11.3-49.2 19.4-98.2 68.7-109.4C1242.1 1697.1 1721 1752 2107.3 1988c43 26.5 56.7 82.6 30.3 125.6zm179.3-398.9c-33.1 53.8-103.5 70.6-157.2 37.6-393.8-242.1-994.4-312.2-1460.3-170.8-60.4 18.3-124.2-15.8-142.6-76.1-18.2-60.4 15.9-124.1 76.2-142.5 532.2-161.5 1193.9-83.3 1646.2 194.7 53.8 33.1 70.8 103.4 37.7 157.1zm15.4-415.6c-472.4-280.5-1251.6-306.3-1702.6-169.5-72.4 22-149-18.9-170.9-91.3-21.9-72.4 18.9-149 91.4-171 517.7-157.1 1378.2-126.8 1922 196 65.1 38.7 86.5 122.8 47.9 187.8-38.5 65.2-122.8 86.7-187.8 48z"
      />
    </svg>
  );
};

export interface AppleMusicMarkProps {
  /** px (default 32 reference px). */
  size?: number;
  /** The colour icon (default) or the white one. */
  variant?: 'color' | 'white';
  /** Where the app's `public/assets` is served (default `product`). */
  assets?: string;
  style?: CSSProperties;
}

/** The official Apple Music icon (the app's `public/assets/apple-music/`). */
export const AppleMusicMark: React.FC<AppleMusicMarkProps> = ({
  size,
  variant = 'color',
  assets = PRODUCT_ASSETS_PATH,
  style,
}) => {
  const {unit} = useFormat();
  const px = size ?? 32 * unit;
  return (
    <Img
      src={appAsset(assets, `apple-music/apple-music-icon-${variant}.svg`)}
      style={{width: px, height: px, flexShrink: 0, ...style}}
    />
  );
};

/** The instruments the app has artwork for (`public/assets/instruments/<name>.png`). */
export type Instrument =
  | 'drums'
  | 'guitar'
  | 'bass'
  | 'keys'
  | 'vocals'
  | 'rhythm'
  | 'guitarcoop'
  | 'guitarghl'
  | 'bassghl'
  | 'rhythmghl'
  | 'guitarcoopghl';

export interface InstrumentIconProps {
  instrument: Instrument;
  /** px (default 19 reference px). */
  size?: number;
  /** Where the app's `public/assets` is served (default `product`). */
  assets?: string;
  style?: CSSProperties;
}

/** The app's instrument artwork. */
export const InstrumentIcon: React.FC<InstrumentIconProps> = ({
  instrument,
  size,
  assets = PRODUCT_ASSETS_PATH,
  style,
}) => {
  const {unit} = useFormat();
  const px = size ?? 19 * unit;
  return (
    <Img
      src={appAsset(assets, `instruments/${instrument}.png`)}
      style={{
        width: px,
        height: px,
        objectFit: 'contain',
        flexShrink: 0,
        ...style,
      }}
    />
  );
};

type Fret = 0 | 1 | 2 | 3 | 4;
type Pad = 'red' | 'yellow' | 'blue' | 'green';
type DrumVariant =
  | ''
  | '-sp'
  | '-accent'
  | '-accent-sp'
  | '-ghost'
  | '-ghost-sp';

/** The highway gem sprites the app's chart preview draws with (`public/assets/preview/assets2/`). */
export type GemSprite =
  | `strum${Fret | 5 | 6}`
  | `strum-sp${Fret}`
  | 'strum-sp-active'
  | 'strum-star-sp-active'
  | `hopo${Fret | 5}`
  | `hopo-sp${Fret}`
  | 'hopo-sp-active'
  | 'hopo-star-sp-active'
  | `tap${Fret}`
  | `tap-sp${Fret}`
  | 'tap-sp-active'
  | 'tap-star-sp-active'
  | 'open'
  | 'open-sp'
  | 'open-hopo'
  | 'open-hopo-sp'
  | 'drum-kick'
  | 'drum-kick-sp'
  | `drum-tom-${Pad}${DrumVariant}`
  | `drum-tom-round-${Pad}${DrumVariant}`
  | `drum-cymbal-${Exclude<Pad, 'red'>}${DrumVariant}`
  | 'drum-cymbal-red'
  | 'highway-hit-flame'
  | `highway-sustain-fretted-${Fret | 5}`
  | 'highway-sustain-open';

/** The app ships the plain tap gems as PNG and every other sprite as WebP. */
const gemFile = (sprite: GemSprite): string =>
  /^tap(\d|-sp-active)$/.test(sprite) ? `${sprite}.png` : `${sprite}.webp`;

export interface GemProps {
  sprite: GemSprite;
  /** px; the height follows the sprite's own aspect. */
  width: number;
  /** Where the app's `public/assets` is served (default `product`). */
  assets?: string;
  style?: CSSProperties;
}

/** One of the app's highway gem sprites, for flat layouts (a legend, a card). */
export const Gem: React.FC<GemProps> = ({
  sprite,
  width,
  assets = PRODUCT_ASSETS_PATH,
  style,
}) => (
  <Img
    src={appAsset(assets, `preview/assets2/${gemFile(sprite)}`)}
    style={{width, height: 'auto', display: 'block', ...style}}
  />
);
