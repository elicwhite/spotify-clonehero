/**
 * `AudioSamples` — the wrapper the editor's PCM travels in.
 *
 * Its entire job is to be uninteresting to anything that walks an object's
 * enumerable properties. React's development build does exactly that to every
 * changed prop, and a whole decoded song is more samples than V8 will build a
 * key set for, so a bare `Float32Array` prop throws `RangeError: Invalid
 * array length` mid-commit and freezes the editor. These tests pin the
 * property that prevents it, because nothing else would catch its loss until
 * an album-length chart froze in someone's browser.
 */

import {AudioSamples, audioSamples} from '../audioSamples';

describe('AudioSamples', () => {
  it('hands back exactly the samples it was given', () => {
    const pcm = new Float32Array([0.25, -0.5, 1, -1]);
    expect(new AudioSamples(pcm).data).toBe(pcm);
  });

  it('exposes no enumerable own properties, so a prop walk finds nothing', () => {
    const wrapped = new AudioSamples(new Float32Array(1024));
    const walked: string[] = [];
    for (const key in wrapped) walked.push(key);
    expect(walked).toEqual([]);
    expect(Object.keys(wrapped)).toEqual([]);
    expect(JSON.stringify(wrapped)).toBe('{}');
  });

  it('keeps the samples off the wrapper even as own-property descriptors', () => {
    // `getOwnPropertyNames` sees non-enumerable properties too; a private
    // field is not a property at all, so there is nothing here to walk into.
    const wrapped = new AudioSamples(new Float32Array(8));
    expect(Object.getOwnPropertyNames(wrapped)).toEqual([]);
  });

  it('passes absence through, for a host whose audio has not arrived', () => {
    expect(audioSamples(undefined)).toBeUndefined();
    expect(audioSamples(null)).toBeUndefined();
  });

  it('wraps any buffer it is given, empty included', () => {
    const pcm = new Float32Array([1, 2]);
    expect(audioSamples(pcm)?.data).toBe(pcm);
    // No special case for a zero-length buffer: the waveform code already
    // reads one as nothing to draw, and a factory that quietly returned
    // `undefined` for it would be one more rule to remember.
    const empty = new Float32Array(0);
    expect(audioSamples(empty)?.data).toBe(empty);
  });
});
