/**
 * Interleaved PCM as it crosses a React prop boundary.
 *
 * The editor's waveform surfaces are fed whole decoded songs — a quarter of a
 * billion samples on an album-length chart. React's development build walks
 * the VALUES of changed props to log them to its performance timeline, and
 * `for...in` over a typed array that size asks V8 for a key set it refuses to
 * allocate: `RangeError: Invalid array length`, thrown inside the commit,
 * which leaves the editor frozen at whatever it last rendered. The ceiling is
 * a little over 2^27 elements — around 23 minutes of 48 kHz stereo — and
 * below it there is no error, just a stall: roughly a second per three
 * minutes of audio, per component that received the prop.
 *
 * So the samples travel wrapped. `for...in` over one of these yields nothing
 * — the array is a private field and the accessor lives on the prototype,
 * neither of which is an enumerable own property — and that is the whole of
 * what React's logger looks at. Everything that actually works on the samples
 * reads {@link AudioSamples.data} at the point of use.
 *
 * None of this is visible in production, where that logging does not exist.
 * It is still worth doing: passing a gigabyte of samples through a component
 * tree that only ever forwards them is what makes it possible in the first
 * place, and the same shape protects anything else that walks props.
 */
export class AudioSamples {
  readonly #data: Float32Array;

  constructor(data: Float32Array) {
    this.#data = data;
  }

  /** The interleaved samples. */
  get data(): Float32Array {
    return this.#data;
  }
}

/**
 * Wrap PCM for the trip through the editor's props, passing absence through
 * unchanged so hosts can hand over a buffer they may not have yet.
 *
 * Wrap ONCE per underlying buffer — in a `useMemo` keyed on it — because
 * consumers put the wrapper in their own memo and effect dependencies. A
 * fresh wrapper each render would rebuild every waveform on every render.
 */
export function audioSamples(
  data: Float32Array | null | undefined,
): AudioSamples | undefined {
  return data ? new AudioSamples(data) : undefined;
}
