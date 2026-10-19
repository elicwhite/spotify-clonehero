/**
 * Transfer-list helpers shared by both ends of a worker protocol (the
 * main-thread client posting a request and the worker posting its result).
 */

/**
 * A transfer list with duplicate backing buffers removed. Planar stereo from
 * a mono source hands both channels the SAME `ArrayBuffer`, and naming one
 * buffer twice in a transfer list throws.
 */
export function uniqueBuffers(...views: ArrayBufferView[]): Transferable[] {
  return Array.from(new Set(views.map(v => v.buffer))) as Transferable[];
}
