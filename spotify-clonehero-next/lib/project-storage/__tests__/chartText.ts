/**
 * Reads a project's chart file as text.
 *
 * The store returns the chart as bytes, because a `.mid` project's chart is
 * binary. A test whose fixture is `.chart` asserts on the text, so it decodes
 * here rather than in every assertion.
 */

import type {createOpfsProjectStore} from '../opfsProjectStore';

type Store = ReturnType<typeof createOpfsProjectStore>;

export async function chartTextOf(
  store: Store,
  projectId: string,
): Promise<string> {
  const {data} = await store.readChartFile(projectId);
  return new TextDecoder().decode(data);
}
