/** The current composition's format, from `useVideoConfig`. */
import {useVideoConfig} from 'remotion';
import {formatOf, type Format} from './format';

export const useFormat = (): Format => formatOf(useVideoConfig());
