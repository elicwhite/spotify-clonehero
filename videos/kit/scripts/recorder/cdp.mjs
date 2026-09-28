// A minimal Chrome DevTools Protocol client (Node 24's global WebSocket, no
// dependencies). One browser connection carries flattened sessions
// (Target.attachToTarget with flatten: true), so every page session shares
// the socket.

import fs from 'node:fs';
import path from 'node:path';

/** Connect to a Chrome started with --remote-debugging-port (its http endpoint). */
export async function connectBrowser(cdpHttp) {
  const res = await fetch(`${cdpHttp.replace(/\/$/, '')}/json/version`);
  if (!res.ok) throw new Error(`CDP /json/version returned ${res.status}`);
  const {webSocketDebuggerUrl} = await res.json();
  return openSocket(webSocketDebuggerUrl);
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let nextId = 1;
    const pending = new Map();
    const listeners = new Set();
    const client = {
      send(method, params = {}, sessionId) {
        const id = nextId++;
        const msg = {id, method, params};
        if (sessionId) msg.sessionId = sessionId;
        ws.send(JSON.stringify(msg));
        return new Promise((res, rej) => pending.set(id, {res, rej, method}));
      },
      on(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      close() {
        ws.close();
      },
    };
    ws.addEventListener('open', () => resolve(client));
    ws.addEventListener('error', e => reject(e.error ?? new Error('ws error')));
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error)
          p.rej(
            new Error(
              `${p.method}: ${msg.error.message} ${msg.error.data ?? ''}`,
            ),
          );
        else p.res(msg.result);
        return;
      }
      for (const fn of listeners) fn(msg);
    });
  });
}

/** A page handle bound to one flattened session. */
export function makePage(browser, sessionId, targetId) {
  const page = {
    sessionId,
    targetId,
    send: (method, params) => browser.send(method, params, sessionId),
    /** Subscribe to this session's CDP events; returns an unsubscribe. */
    onEvent(fn) {
      return browser.on(msg => {
        if (msg.sessionId === sessionId && msg.method)
          fn(msg.method, msg.params);
      });
    },
    async eval(expression) {
      const r = await page.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (r.exceptionDetails) {
        throw new Error(
          `eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`,
        );
      }
      return r.result.value;
    },
    /**
     * Viewport and device scale, and optionally a colour scheme
     * (`prefers-color-scheme`: 'dark' or 'light'; null leaves the browser's).
     */
    async emulate({width, height, scale, colorScheme = null}) {
      await page.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: scale,
        mobile: false,
        screenWidth: width,
        screenHeight: height,
      });
      if (colorScheme) {
        await page.send('Emulation.setEmulatedMedia', {
          features: [{name: 'prefers-color-scheme', value: colorScheme}],
        });
      }
    },
    async navigate(url) {
      await page.send('Page.navigate', {url});
      await page.waitFor('document.readyState === "complete"');
    },
    /** Poll a (possibly async) page expression until it is truthy. */
    async waitFor(expression, {timeoutMs = 30000, intervalMs = 150} = {}) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        try {
          if (await page.eval(`(async () => Boolean(await (${expression})))()`))
            return true;
        } catch {
          // A navigation is in flight; try again.
        }
        await sleep(intervalMs);
      }
      throw new Error(`timed out waiting for: ${expression}`);
    },
    /** Full-viewport PNG at the emulated device scale factor. */
    async shot(file) {
      const {data} = await page.send('Page.captureScreenshot', {format: 'png'});
      fs.mkdirSync(path.dirname(file), {recursive: true});
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    },
  };
  return page;
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
