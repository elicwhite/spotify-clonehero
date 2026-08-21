/**
 * The `tools` parameter on `chart_exported` — which assist tasks a shipped
 * chart was built with (plan 0105).
 *
 * The task keys themselves cannot be used. Sorted and comma-joined, all six
 * come to 106 characters, and GA4 drops a parameter value past 100 — so the
 * one row the plan most wants, the chart that used every tool, would be the
 * single row that silently lost the field. Truncating instead would be
 * worse: a cut mid-key invents a tool name that does not exist.
 *
 * So each task gets a short, stable analytics id. All six join to well under
 * the limit, with room for several more tasks, and the values stay readable
 * in a report without a legend.
 */

import type {AssistTaskKey} from '@/lib/assist/tasks/types';

/** Analytics id per task. These are a wire format: changing one splits its
 *  history in two, so treat them as fixed once released. Exported for the
 *  test that holds the ids unique and the joined value inside the limit. */
export const TOOL_ANALYTICS_ID = {
  'add-leading-silence': 'silence',
  'add-lyrics': 'lyrics',
  'generate-difficulties': 'difficulties',
  'generate-sections': 'sections',
  'generate-tempo-map': 'tempo',
  'transcribe-drums': 'drums',
} as const satisfies Record<AssistTaskKey, string>;

/**
 * Sorted so that one combination of tools is one row in a report, rather
 * than one row per order the user happened to run them in.
 */
export function toolsParam(tools: readonly AssistTaskKey[]): string {
  return (
    [...new Set(tools)]
      .map(task => TOOL_ANALYTICS_ID[task])
      // `toolsApplied` is read back from a project's `metadata.json`, which a
      // rename or a removal can leave holding a key this map no longer has.
      // Unfiltered, that key maps to `undefined` and joins as an empty
      // segment, so the chart exports `"lyrics,"` — neither the old id nor
      // absent, and a row of its own in every report.
      .filter(id => id !== undefined)
      .sort()
      .join(',')
  );
}
