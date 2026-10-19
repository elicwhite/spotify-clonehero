// From https://github.com/Geomitron/chorus-encore/blob/master/src-shared/utils.ts
import _ from 'lodash';

/**
 * @returns extension of a file, excluding the dot. (e.g. "song.ogg" -> "ogg")
 */
export function getExtension(fileName: string) {
  return _.last(fileName.split('.')) ?? '';
}

/**
 * @returns basename of a file, excluding the dot. (e.g. "song.ogg" -> "song")
 */
export function getBasename(fileName: string) {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts.slice(0, -1).join('.') : fileName;
}

/**
 * @returns `true` if `fileName` has a valid chart audio file extension.
 */
export function hasAudioExtension(fileName: string) {
  return ['ogg', 'mp3', 'wav', 'opus'].includes(
    getExtension(fileName).toLowerCase(),
  );
}

/**
 * @returns `true` if `fileName` has a valid chart audio fileName.
 */
export function hasAudioName(fileName: string) {
  return (
    [
      'song',
      'guitar',
      'bass',
      'rhythm',
      'keys',
      'vocals',
      'vocals_1',
      'vocals_2',
      'drums',
      'drums_1',
      'drums_2',
      'drums_3',
      'drums_4',
      'crowd',
      'preview',
    ].includes(getBasename(fileName)) &&
    ['ogg', 'mp3', 'wav', 'opus'].includes(getExtension(fileName))
  );
}

/**
 * @returns `true` if `fileName` has a valid chart file extension.
 */
export function hasChartExtension(fileName: string) {
  return ['chart', 'mid'].includes(getExtension(fileName).toLowerCase());
}

/**
 * @returns `true` if `fileName` is a valid chart fileName.
 */
export function hasChartName(fileName: string) {
  return ['notes.chart', 'notes.mid'].includes(fileName);
}

/**
 * @returns `true` if `fileName` is a valid video fileName.
 */
export function hasVideoName(fileName: string) {
  return (
    getBasename(fileName) === 'video' &&
    ['mp4', 'avi', 'webm', 'vp8', 'ogv', 'mpeg'].includes(
      getExtension(fileName),
    )
  );
}

/**
 * @returns `true` if `fileName` has a valid ini file extension.
 */
export function hasIniExtension(fileName: string) {
  return 'ini' === getExtension(fileName).toLowerCase();
}

/**
 * @returns `true` if `fileName` is a valid ini fileName.
 */
export function hasIniName(fileName: string) {
  return fileName === 'song.ini';
}
