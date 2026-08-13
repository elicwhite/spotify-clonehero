/**
 * The catalog generation the deployed app expects, compared against what a
 * client has stored to decide whether its catalog must be replaced.
 *
 * `/api/data` is a route in this same app, built and deployed from this same
 * commit, returning a constant. There is nothing here to validate that the
 * build has not already guaranteed: a response that is not the JSON we wrote
 * means the request never reached the route, and `response.json()` throws on
 * its own.
 */
export async function getServerChartsDataVersion(): Promise<number> {
  const response = await fetch('/api/data');
  const {chartsDataVersion} = await response.json();
  return chartsDataVersion as number;
}
