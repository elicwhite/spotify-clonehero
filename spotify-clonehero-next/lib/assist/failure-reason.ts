/**
 * What killed a failed assist run, as a closed set that is safe to report.
 *
 * A run's error message stays on the page: it can name a file the user
 * loaded. The step says where a run died. This says why, for the tasks whose
 * errors carry a label, so that two different faults at the same step do not
 * look the same in analytics and Sentry.
 */

import {
  AlignFailureError,
  type AlignFailureReason,
} from '@/lib/lyrics-align/align-failure';

export type AssistFailureReason = AlignFailureReason;

/** The reason `error` carries, or undefined when it carries none. */
export function assistFailureReason(
  error: unknown,
): AssistFailureReason | undefined {
  return error instanceof AlignFailureError ? error.reason : undefined;
}
