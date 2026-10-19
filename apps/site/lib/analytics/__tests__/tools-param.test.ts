/**
 * The `tools` parameter's three load-bearing properties (plan 0105).
 *
 * All three are the kind that hold today and quietly stop holding when
 * someone adds a task, which is exactly why they are asserted against the
 * full key list rather than against a hand-written example.
 */

import type {AssistTaskKey} from '@/lib/assist/tasks/types';
import {MAX_GA_PARAM_LENGTH} from '../limits';
import {TOOL_ANALYTICS_ID, toolsParam} from '../tools-param';

/** Every task, from the map the compiler holds total against AssistTaskKey. */
const ALL_TASKS = Object.keys(TOOL_ANALYTICS_ID) as AssistTaskKey[];

test('every task has an id, and no two tasks share one', () => {
  // A collision would merge two tools into one row and make the merged row
  // impossible to tell from a genuine single-tool export.
  const ids = Object.values(TOOL_ANALYTICS_ID);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.every(id => id.length > 0)).toBe(true);
});

test('every task at once still fits in a GA4 parameter', () => {
  // This is the whole reason the short ids exist: the raw task keys came to
  // 106 characters, so the chart that used every tool was the one row GA4
  // would have dropped. It has to keep holding as tasks are added.
  const value = toolsParam(ALL_TASKS);
  expect(value.length).toBeLessThanOrEqual(MAX_GA_PARAM_LENGTH);
  expect(value.split(',')).toHaveLength(ALL_TASKS.length);
});

test('the value is sorted, so one combination is one row', () => {
  const forwards = toolsParam(['add-lyrics', 'generate-tempo-map']);
  const backwards = toolsParam(['generate-tempo-map', 'add-lyrics']);
  expect(forwards).toBe(backwards);
  expect(forwards).toBe('lyrics,tempo');
});

test('a task recorded twice is reported once', () => {
  expect(toolsParam(['add-lyrics', 'add-lyrics'])).toBe('lyrics');
});

test('a key this map no longer knows is dropped, not joined as a blank', () => {
  // `toolsApplied` is persisted, so a renamed or removed task can come back
  // out of a project written by an older build. Joining it as an empty
  // segment would export `"lyrics,"`.
  const stale = ['add-lyrics', 'retired-task'] as unknown as AssistTaskKey[];
  expect(toolsParam(stale)).toBe('lyrics');
});

test('a chart with no tools reports an empty value, not a placeholder', () => {
  expect(toolsParam([])).toBe('');
});
