/**
 * The brand colours the Blender logo sting reads (`blender/sting_look.py`),
 * as plain JSON. All values are sRGB hex.
 */
import {color, lane} from './tokens';

export interface BrandJson {
  colors: {
    /** The logo square. */
    primary: string;
    /** Glow purple. */
    accent: string;
    /** Guitar fret order; orange is the drum kick colour. */
    lanes: {
      green: string;
      red: string;
      yellow: string;
      blue: string;
      orange: string;
    };
  };
}

export const brandJson = (): BrandJson => ({
  colors: {
    primary: color.brand,
    accent: color.purple,
    lanes: {
      green: lane.green,
      red: lane.red,
      yellow: lane.yellow,
      blue: lane.blue,
      orange: lane.kick,
    },
  },
});
