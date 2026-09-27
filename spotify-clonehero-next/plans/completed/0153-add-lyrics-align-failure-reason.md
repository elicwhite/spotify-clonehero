# 0153 — Tell alignment failures apart in telemetry

Status: completed

## Problem

GA, last 28 days to 2026-09-27: `add-lyrics` failed 26 times. 24 of the
failures are step `align` on Opera, and the report read this as "Opera cannot
run the align step".

The data does not support that reading:

- The 24 failures come from one person: one country (Canada), Opera on
  Windows, one day (2026-09-26, 08:00 to 13:00 UTC). GA counts two users
  because there were two client IDs.
- Every one failed fast: mean `durationMs` 537, hourly means 320 to 841. The
  person reloaded the page and loaded different charts (folder and `.sng`)
  between tries. The failure did not go away.
- Opera runs `align` for other people. Completed Opera runs: 2026-08-30
  (dialog, 301 s), 2026-09-19 (landing, 73 s), 2026-09-24 (Mexico, dialog,
  197 s). The last one is after the shader-f16 change (merged 2026-09-20).

The fast time limits the cause. Step `align` means that the worker sent at
least one progress message, so the worker loaded. The cause must be one of
these, and each fails in less than one second:

1. The model download fails at once (host blocked, 403/429, not reachable).
   `getCachedModel` retries with no delay, so four attempts take
   milliseconds.
2. The WebGPU session does not build, and the fallback then runs the fp16
   model on WASM, which also fails.
3. Something else in the worker.

The telemetry cannot tell these apart. `reportInfraError` sends Sentry only
the error class and the stack, not the message. The worker sends its failure
to the page as a string, and `aligner.ts` makes a plain `Error` from it in the
same handler each time. So every alignment failure is the same Sentry issue,
`assist run failed at align (Error)`, with the same stack. Sentry does not
have the message that the task description expects.

## Change

Instrumentation only. The alignment behaviour does not change.

- `lib/lyrics-align/align-failure.ts`: `AlignFailureReason`, a closed set.
  Values: `worker-error`, `model-download-<kind>`, `session-<backend>`,
  `inference-<backend>`, `alignment`. The backend is `webgpu`, `wasm`, or
  `wasm-fp16` (the fp16 model on WASM after the WebGPU session failed).
- `model-cache.ts`: `ModelDownloadError` has a `failure` kind:
  `http-refused`, `http-429`, `http-5xx`, `network`, `truncated`,
  `not-a-model`.
- `aligner-worker.ts` labels each stage and sends `reason` with each error.
  `aligner.ts` rejects with `AlignFailureError`.
- `useAssistRunner` adds `reason` to `assist_run_failed` in GA. The GA
  parameter is `reason`, and `customEvent:reason` is already registered. It
  also adds `reason` to the Sentry summary and tags. Sentry groups an event
  with a stack on the exception type and the in-app frames, not on the
  message, so different reasons can share one issue. Filter on the `reason`
  tag to separate them.

## How to read it after deploy

```json
{"dimensions":[{"name":"browser"},{"name":"customEvent:step"},{"name":"customEvent:reason"}],
 "metrics":[{"name":"eventCount"},{"name":"totalUsers"}],
 "dimensionFilter":{"filter":{"fieldName":"eventName","stringFilter":{"matchType":"EXACT","value":"assist_run_failed"}}}}
```

- `model-download-network` or `model-download-http-*`: the model host is
  blocked or refuses this user. Next: show a clear message that names the
  cause, and wait between retries.
- `session-wasm-fp16`: the WebGPU session fails on a device that has
  shader-f16. Next: fall back to the int8 model on WASM, not the fp16 model.
- `inference-webgpu`: the forward pass fails (for example, the device is
  lost). Next: test the chunk size and the device limits.

## Tests

- `lib/lyrics-align/__tests__/model-cache-download.test.ts`: each download
  failure kind.
- `lib/lyrics-align/__tests__/align-failure.test.ts`: the download reason.
- `lib/lyrics-align/__tests__/aligner-client.test.ts`: the page keeps the
  worker's reason, and a dead worker gives `worker-error`.
- `components/assist/__tests__/assist-run-analytics.test.tsx`: the reason goes
  to GA and Sentry, and no `reason` field is sent when there is none.
