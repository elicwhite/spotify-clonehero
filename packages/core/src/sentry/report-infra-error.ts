import * as Sentry from '@sentry/nextjs';

/**
 * Reports a failure that is ours, not the user's.
 *
 * The funnel counts every refusal, but a count cannot say why a model
 * download died on someone's connection or why an OPFS write failed on their
 * device. Those are faults with a cause worth finding, so they are reported
 * here as well as counted. A chart the editor refuses is not: the user
 * brought a chart with no audio, the product said so, and nothing is broken.
 *
 * **The original message is never sent.** It can name the file the user
 * loaded, and a chart tool that promises files never leave the browser must
 * not post their names to a third party. What is sent instead is the error's
 * class, which is where the diagnosis actually lives — `QuotaExceededError`,
 * `TypeError` for a dead fetch, `AbortError` — with the step that was running
 * as the summary, and the stack frames, which are our own code.
 *
 * The frames only. V8 writes the message into the first line of `stack`, so
 * copying a stack across verbatim would carry the message with it — which is
 * how the leak this guards against would actually happen.
 */
export function reportInfraError(
  error: unknown,
  {summary, tags}: {summary: string; tags: Record<string, string>},
): void {
  try {
    const scrubbed = new Error(`${summary} (${classOf(error)})`);
    // Sentry groups on name + message, so keeping the class as the name puts
    // a quota failure and a network failure in different issues.
    scrubbed.name = classOf(error);
    const frames = framesOf(error);
    if (frames)
      scrubbed.stack = `${scrubbed.name}: ${scrubbed.message}\n${frames}`;
    Sentry.captureException(scrubbed, {tags});
  } catch {
    // Reporting a failure must never become one.
  }
}

/** A stack with its header line dropped: everything from the first frame on.
 *  Returns undefined when there is nothing that looks like a frame, rather
 *  than guessing at a format this does not recognise. */
function framesOf(error: unknown): string | undefined {
  const stack = (error as {stack?: unknown})?.stack;
  if (typeof stack !== 'string') return undefined;
  const frames = stack
    .split('\n')
    .filter(line => /^\s+at\s/.test(line))
    .join('\n');
  return frames || undefined;
}

/** The error's constructor name — `DOMException` reports its own `name`
 *  instead, because that is where `QuotaExceededError` lives. */
function classOf(error: unknown): string {
  if (error instanceof DOMException) return error.name;
  if (error instanceof Error) return error.name || 'Error';
  return typeof error;
}
