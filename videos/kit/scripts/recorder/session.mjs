// A tab of the running app under the recorder: the virtual clock, the fiber
// and element-box helpers injected before any page script, capture hygiene,
// emulation, and real input (mouse, keys) plus WebMCP tool calls. App
// adapters (apps/<app>/session.mjs) build their setup steps on these.

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {makePage} from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSource = name => fs.readFileSync(path.join(HERE, name), 'utf8');

// Capture hygiene, applied on every load: no classic scrollbars (a trackpad
// Mac shows overlay bars that take no space) and no Next.js dev badge.
// Nothing about the app's own layout or styling changes.
export const HYGIENE = `(() => {
  const css = 'nextjs-portal{display:none!important}*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}';
  const add = () => { if (document.getElementById('recorder-hygiene')) return; const s = document.createElement('style'); s.id = 'recorder-hygiene'; s.textContent = css; (document.head || document.documentElement).appendChild(s); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();`;

/**
 * A new tab with the virtual clock, the fiber and element-box helpers,
 * hygiene and any `scripts` (page sources, e.g. an app probe) injected at
 * document start, emulating `viewport` ({width, height, scale}) and, when
 * given, `colorScheme` ('dark' | 'light'). `dateBaseMs` is the page's
 * `Date.now()` as the tab opens (virtual-clock.js). The tab's time zone,
 * locale and languages are fixed (UTC, en-US), so dates and numbers the
 * page formats are the same on every machine.
 */
export async function openTab(
  browser,
  {viewport, colorScheme = null, scripts = [], dateBaseMs},
) {
  if (!Number.isFinite(dateBaseMs))
    throw new Error(`openTab needs the page's date base, got ${dateBaseMs}`);
  const {userAgent} = await browser.send('Browser.getVersion');
  // The real time the tab opens at, for the page's date before the clock stops.
  const realAnchorMs = Date.now();
  const {targetId} = await browser.send('Target.createTarget', {
    url: 'about:blank',
  });
  const {sessionId} = await browser.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  const page = makePage(browser, sessionId, targetId);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('DOM.enable');
  await page.emulate({...viewport, colorScheme});
  await page.send('Emulation.setFocusEmulationEnabled', {enabled: true});
  await page.send('Emulation.setTimezoneOverride', {timezoneId: 'UTC'});
  await page.send('Emulation.setLocaleOverride', {locale: 'en-US'});
  await page.send('Emulation.setUserAgentOverride', {
    userAgent,
    acceptLanguage: 'en-US',
  });
  for (const source of [
    `window.__recClockConfig = ${JSON.stringify({dateBaseMs, realAnchorMs})};`,
    readSource('virtual-clock.js'),
    readSource('fiber.js'),
    readSource('dom.js'),
    HYGIENE,
    ...scripts,
  ]) {
    await page.send('Page.addScriptToEvaluateOnNewDocument', {source});
  }
  return page;
}

/** Close a tab opened with `openTab` (errors ignored: the tab may be gone). */
export const closeTab = (browser, page) =>
  browser.send('Target.closeTarget', {targetId: page.targetId}).catch(() => {});

/**
 * Where the pointer parks between gestures: 4 px inside the viewport's
 * bottom-right corner, off anything an app puts under the pointer there.
 */
export const parkPoint = viewport => ({
  x: viewport.width - 4,
  y: viewport.height - 4,
});

/** Move the pointer to its parking spot. */
export const park = (page, viewport) =>
  page.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    ...parkPoint(viewport),
    button: 'none',
    buttons: 0,
    pointerType: 'mouse',
  });

/** A real click at (x, y) CSS px: move, press, release. */
export async function click(page, x, y, {button = 'left'} = {}) {
  const base = {x, y, pointerType: 'mouse', modifiers: 0};
  await page.send('Input.dispatchMouseEvent', {
    ...base,
    type: 'mouseMoved',
    button: 'none',
    buttons: 0,
  });
  await page.send('Input.dispatchMouseEvent', {
    ...base,
    type: 'mousePressed',
    button,
    buttons: button === 'left' ? 1 : 2,
    clickCount: 1,
  });
  await page.send('Input.dispatchMouseEvent', {
    ...base,
    type: 'mouseReleased',
    button,
    buttons: 0,
    clickCount: 1,
  });
}

/**
 * Scroll the element a page expression (`findJs`) returns into view and
 * click its center with a real mouse event.
 */
export async function clickElement(page, findJs) {
  const at = await page.eval(`(() => {
    const el = ${findJs};
    if (!el) return null;
    el.scrollIntoView({block: 'center'});
    return window.__recDom.centre(el);
  })()`);
  if (!at) throw new Error(`nothing to click: ${findJs}`);
  await click(page, at.x, at.y);
}

/** CDP modifier bits for key and mouse events: `MOD.meta` is Cmd. */
export const MOD = {alt: 1, ctrl: 2, meta: 4, shift: 8};

const codeFor = key => {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (key === ' ') return 'Space';
  return key;
};
const keyCodeFor = key => {
  const table = {
    Backspace: 8,
    Tab: 9,
    Enter: 13,
    Escape: 27,
    ' ': 32,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Delete: 46,
  };
  if (key in table) return table[key];
  if (/^[a-z]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(key)) return key.charCodeAt(0);
  return 0;
};

/**
 * Press and release `key` with real key events: 'Escape', 'Delete', or a
 * character, which types itself unless Cmd or Ctrl is held. `code`,
 * `keyCode` and `text` override what the key name implies.
 */
export async function pressKey(
  page,
  key,
  {modifiers = 0, code, keyCode, text} = {},
) {
  const typed =
    text ??
    (key.length === 1 && !(modifiers & (MOD.meta | MOD.ctrl))
      ? key
      : undefined);
  const base = {
    key,
    code: code ?? codeFor(key),
    windowsVirtualKeyCode: keyCode ?? keyCodeFor(key),
    nativeVirtualKeyCode: keyCode ?? keyCodeFor(key),
    modifiers,
  };
  await page.send('Input.dispatchKeyEvent', {
    ...base,
    type: typed ? 'keyDown' : 'rawKeyDown',
    text: typed,
    unmodifiedText: typed,
  });
  await page.send('Input.dispatchKeyEvent', {...base, type: 'keyUp'});
}

/**
 * Call one of the page's WebMCP tools (`navigator.modelContextTesting`, the
 * testing surface of the WebMCP draft) and return its parsed result: the
 * first text content, as JSON when it parses.
 */
export function mcp(page, tool, args = {}) {
  return page.eval(`(async () => {
    let r = await navigator.modelContextTesting.executeTool(${JSON.stringify(tool)}, ${JSON.stringify(JSON.stringify(args))});
    if (typeof r === 'string') r = JSON.parse(r);
    const text = r?.content?.[0]?.text ?? '';
    try { return JSON.parse(text); } catch { return text; }
  })()`);
}

/**
 * A page expression for the boxes (CSS px) of the first element each CSS
 * selector matches ({name: box}, null when none does).
 */
export const elementBoxesJs = selectors =>
  `window.__recDom.boxes(${JSON.stringify(selectors)})`;

/** The boxes `elementBoxesJs` reads, measured now. */
export const measureSelectors = (page, selectors) =>
  page.eval(elementBoxesJs(selectors));
