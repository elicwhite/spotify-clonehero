export const CHORUS_UNAVAILABLE_MESSAGE =
  'Failed to fetch charts from Chorus, try again later';

/**
 * Thrown when the Chorus/Encore API is unreachable or keeps answering with a
 * server error after every retry. This is an outage on their side, not a bug
 * in this app, so callers surface it to the user and skip error reporting.
 */
export class ChorusUnavailableError extends Error {
  readonly status: number | undefined;

  constructor(status?: number, options?: {cause?: unknown}) {
    super(CHORUS_UNAVAILABLE_MESSAGE, options);
    this.name = 'ChorusUnavailableError';
    this.status = status;
  }
}

export function isChorusUnavailableError(error: unknown): boolean {
  return (
    error instanceof ChorusUnavailableError ||
    (error instanceof Error && error.name === 'ChorusUnavailableError')
  );
}
