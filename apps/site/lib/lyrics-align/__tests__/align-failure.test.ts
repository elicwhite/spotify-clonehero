/**
 * A download failure must report which kind of download failure it was, not
 * only that the download failed.
 */

import {modelDownloadReason} from '@/lib/lyrics-align/align-failure';
import {ModelDownloadError} from '@/lib/lyrics-align/model-cache';

test('a model download error reports its failure kind', () => {
  expect(
    modelDownloadReason(new ModelDownloadError('rate limited', 'http-429')),
  ).toBe('model-download-http-429');
});

test('any other error from the download reports model-download-other', () => {
  // `getCachedModel` can also throw an error it did not make, such as a
  // RangeError from allocating the model's buffer.
  expect(modelDownloadReason(new RangeError('Array buffer allocation'))).toBe(
    'model-download-other',
  );
});
