// The harness side of the virtual clock's worker gate (virtual-clock.js).
// A worker runs in real time, so its replies would land on whatever frame
// the machine's speed decides. Arm the gate before the page creates the
// worker (say, on the frame of the click that starts it), then hand its
// messages to the page on the frames the plan chooses:
//
//   plan.call(press, armWorkerGate);
//   for (let f = release + 1; f < done; f++)
//     plan.call(f, page => deliverWhen(page, s => s.held.length > s.delivered, 'the next message'));
//
// Waits run in real time while the page's clock stays frozen, so a slow
// worker costs capture time, never a frame.

import {sleep} from './cdp.mjs';

/** Gate the next worker the page creates. */
export const armWorkerGate = page =>
  page.eval('window.__recClock.workers.arm()');

/** {armed, created, gated, held: [message types], delivered}. */
export const workerGateStatus = page =>
  page.eval('window.__recClock.workers.status()');

/** Hand the page the next held message and let it settle; returns the message's type. */
export async function deliverWorkerMessage(page) {
  const type = await page.eval('window.__recClock.workers.deliverNext()');
  await page.eval('window.__recClock.settle()');
  return type;
}

/**
 * Wait (real time) until `ready(status)` holds, then return the status.
 * `what` names the wait in the timeout error.
 */
export async function waitForWorker(page, ready, what, timeoutMs = 120000) {
  const t0 = Date.now();
  for (;;) {
    const status = await workerGateStatus(page);
    if (ready(status)) return status;
    if (Date.now() - t0 > timeoutMs)
      throw new Error(
        `worker gate: timed out waiting for ${what} (${JSON.stringify(status)})`,
      );
    await sleep(20);
  }
}

/** Wait until `ready(status)` holds, then deliver the next held message. */
export async function deliverWhen(page, ready, what, timeoutMs) {
  await waitForWorker(page, ready, what, timeoutMs);
  return deliverWorkerMessage(page);
}
