# 0151 — Say why the beat model will not download on the old domain

Status: completed

## Why

In the 28 days to 2026-09-27, `generate-tempo-map` failed 50 times; about 42
of those failed at `download-beat-model`. `generate-sections` failed twice at
that step too. Split by `hostName`, all of them (40 + 2) came from
`cloneherocharts.vercel.app`. On `musiccharts.tools` the step failed 0 times in
119 completed runs.

The cause is not in the download code. `beat_this.onnx` is on R2 at
`assets.musiccharts.tools`. The bucket's CORS rules send
`Access-Control-Allow-Origin` only for `https://musiccharts.tools` and
`https://www.musiccharts.tools`. A request from any other origin gets a 200
with no CORS header (checked with `curl -H 'Origin: …'`). The browser then
withholds the response, and `fetch` rejects with a bare TypeError.
`downloadModel` treats that as a network drop. It retries 4 times at once, then
says "Couldn't reach the AI model server. Check your internet connection". That
is false, so users retried: one user tried 19 times in 28 minutes. Each retry
after the first failed in 2–4 s, because the drum stem was in the cache.

The same CORS rule breaks every R2 asset on that domain. On
`cloneherocharts.vercel.app`, `transcribe-drums` failed 39 times at
`transcribing` (CRNN model) and `generate-difficulties` failed 54 times at
`reduce` (guitar-reduction model). Neither failed on `musiccharts.tools`.
Those two tools use their own `fetch`, not `getCachedModel`, so this plan does
not change their message.

## Fix outside the repo (required)

Add `https://cloneherocharts.vercel.app` to the R2 bucket's CORS
`AllowedOrigins`, or redirect that domain to `musiccharts.tools` in Vercel. A
redirect strands every user's OPFS data on the old origin, so the CORS rule is
the safer fix. Neither is in this repository.

## Change

`getCachedModel` now tells a CORS refusal from a network drop. When every
attempt got no response, it sends one `mode: 'no-cors'` HEAD request. If that
request gets an opaque response, the host is up and refused this origin. The
error then names the page's host and tells the user to open the tool at the
canonical site (`getSiteUrl()`). On the canonical site itself, it says to try
again later. If the probe also fails, the old network message stays.

The message also goes to Sentry through `reportInfraError`, so the cause is
visible there.

## Done when

- The three new cases in `model-cache-download.test.ts` pass, and two of them
  fail without the change.
- Typecheck and lint pass on the changed files.
