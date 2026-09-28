// CORS for an app origin an asset host does not list.
//
// An app recorded from a local server often fetches from a host whose CORS
// policy names only the app's production origin (the chart editor's model
// host does). This pauses that host's responses in this browser session (the
// CDP Fetch domain) and adds an Access-Control-Allow-Origin for the page's
// origin. The bytes are the host's own; nothing in the app changes.
//
//   await enableCorsBridge(page, {urlPattern: 'https://assets.example/*', origin: await page.eval('location.origin')});

const bridged = new WeakSet();

export async function enableCorsBridge(page, {urlPattern, origin}) {
  if (bridged.has(page)) return;
  bridged.add(page);
  page.onEvent(async (method, params) => {
    if (method !== 'Fetch.requestPaused') return;
    const {requestId, responseStatusCode, responseHeaders} = params;
    if (responseStatusCode === undefined) {
      await page.send('Fetch.continueRequest', {requestId}).catch(() => {});
      return;
    }
    const headers = (responseHeaders ?? []).filter(
      h => h.name.toLowerCase() !== 'access-control-allow-origin',
    );
    headers.push({name: 'Access-Control-Allow-Origin', value: origin});
    await page
      .send('Fetch.continueResponse', {
        requestId,
        responseCode: responseStatusCode,
        responseHeaders: headers,
      })
      .catch(() =>
        page.send('Fetch.continueRequest', {requestId}).catch(() => {}),
      );
  });
  await page.send('Fetch.enable', {
    patterns: [{urlPattern, requestStage: 'Response'}],
  });
}
