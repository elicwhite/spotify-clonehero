# 0125 — Build production on Vercel again, keep the CI gate

Status: in-progress

Production stopped being built on Vercel in 7468e6c4 (2026-08-12, "Gate
production on jest, eslint and the typechecker"). Every value the build read
from a Vercel-injected environment variable has been wrong since, and each one
failed silently.

## Why

Vercel's system environment variables are injected by Vercel's build
infrastructure. The deploy job in `.github/workflows/ci.yml` builds on a GitHub
runner and uploads the result with `--prebuilt`. Vercel documents this exact
consequence:

> When using the `--prebuilt` flag, System Environment Variables will be
> missing at build time, so frameworks that rely on them at build time may not
> function correctly. […] If you need System Environment Variables at build
> time, do not use the `--prebuilt` flag or use Git-based deployments.
> — [vercel deploy](https://vercel.com/docs/cli/deploy#when-not-to-use-prebuilt)

Runtime is unaffected — functions still execute on Vercel. The split that
matters is build-time versus runtime, not "Vercel versus not".

## Measured damage

| Consumer | Reads | Result |
| --- | --- | --- |
| `lib/site-url.ts` | `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_URL` | shipped `og:image` of `http://localhost:3000/...`; every unfurl card imageless. Already fixed by making the canonical domain a constant, pinned by `__tests__/site-url.test.ts` |
| `instrumentation-client.ts` | `NEXT_PUBLIC_VERCEL_ENV` | undefined → environment `development` → `enabled: false`. Verified live: the client on musiccharts.tools reports `{environment: "development", enabled: false}`. No browser errors reported from production |
| `sentry.server.config.ts` | `VERCEL_ENV` | read at module load, which happens at build and at runtime, so one deploy can tag events two ways |

Sentry's own data dates it. Errors by environment, last 90 days:

| environment | count | last seen |
| --- | --- | --- |
| `development` | 532 | 2026-08-08 |
| `vercel-production` | 251 | 2026-08-15 |
| `production` | 50 | 2026-08-12 21:50 |

The last `production` event is the evening of the CI move, and nothing at all
has arrived since 2026-08-15. `vercel-production` is not a value this repo
sets — it is the SDK's own Vercel fallback, reached whenever our explicit
`environment` was undefined, which is why one project has three spellings of
one environment.

That `4166ebdd` (2026-08-16, "Report errors from Find Music again") is followed
by silence is the clearest statement of the problem: a fix shipped into a
reporting path that was already dead.

## The fix: stop prebuilding, keep the gate

The gate and the local build are separable. The gate is that the `deploy` job
`needs: [test, lint, typecheck]`. Building on the runner is not what enforces
it, and the CLI builds on Vercel whenever `--prebuilt` is absent.

In `.github/workflows/ci.yml`:

- Delete the `Pull Vercel project settings` step. `vercel pull` only exists to
  feed `vercel build` and `vercel dev`.
- Delete the `Build` step.
- Drop `--prebuilt` from the `Deploy` step, changing nothing else about it.

`deploy` waits for the build and exits non-zero if it fails, so a broken build
still turns CI red. Build output moves to Vercel, one click from the inspect
URL the CLI prints on failure. `--logs` would bring it back into the job log;
it is left off only because the step captures stdout to set `environment.url`
and nobody has confirmed that `--logs` writes to stderr. The docs say stdout is
always the deployment URL, so adding the flag is probably safe — confirm on a
deploy, then add it.

Two limits apply to the upload, both from
[Limits](https://vercel.com/docs/limits#static-file-uploads): 15,000 files, and
100 MB of source on Hobby or 1 GB on Pro. This repo is 1,869 tracked files and
80 MB, which is comfortable on Pro and would be 80% of the ceiling on Hobby.
The project is team-owned, so Pro or better, and `--archive` is not needed.

Do not reach for a `.vercelignore` to trim that upload without checking what it
does to `.gitignore` first. Today the CLI excludes what `.gitignore` excludes,
which is what keeps the ~1 GB of untracked model files in `public/` out of the
upload. If a `.vercelignore` supersedes `.gitignore` rather than adding to it,
introducing one would upload all of it.

Every failure above then disappears at its root, because the code was correct
about where it ran — the build simply stopped running there.

## What this costs

- Build minutes move from the GitHub runner to Vercel.
- Vercel's remote build cache replaces the runner's. The jest cache note in
  `jest.config.js` still holds: the suite runs in its own job, not in `build`.

## What it does not cost

Nothing about the gate. There is still no path from a push to production that
skips test, lint and typecheck, and `vercel.json`'s `git.deploymentEnabled:
false` still stands, so the catalog-generation wait step keeps running before
any deploy. That step is also why plain Git-based deployment is not the answer
here: it would deploy on push, with nothing to hold it until a matching catalog
is published.

## Then verify against production, not the diff

The bug class is "looks right, reports nothing", so the diff cannot be the
evidence.

- Confirm `NEXT_PUBLIC_VERCEL_ENV` is inlined in the shipped client bundle. It
  is currently a runtime `process.env` lookup on the client shim, which is how
  the absence was proven; compare against `NEXT_PUBLIC_SUPABASE_URL`, which
  inlines correctly today.
- Trigger one error in production and confirm it arrives tagged `production`,
  not `development` or `vercel-production`.
- Confirm a deployed page's `og:image` is absolute.
- Confirm **Enable access to System Environment Variables** is checked in
  project settings. Everything here assumes it; nothing here works without it.

## Still half-fixed after this

Moving the build restores the value `getSentryEnvironment` reads, but not the
thing that made its absence expensive. `getSentryEnvironment(undefined)`
returns `development` and `isSentryEnabled` turns that into `enabled: false`,
silently, and no test asserts that a production build reports at all. That
fallback is the whole reason a month of browser errors went unnoticed, and it
is still one workflow edit away from happening again.

Harden it separately: a production build whose environment is unrecognised
should fail loudly rather than disable reporting, with a unit test pinning
that. Note that the value cannot become a constant the way `getSiteUrl`'s did —
`NODE_ENV` is `production` for preview deployments too, so a constant would
label previews as production. `VERCEL_ENV` is the right source once the build
runs where it is set.

## Decide separately

`lib/site-url.ts` works either way once builds move back. Keeping the constant
costs nothing and removes the one value whose silent wrong answer stayed
invisible for a month; reverting to `VERCEL_PROJECT_PRODUCTION_URL` is
defensible now that it resolves. Not urgent either way.

## Also found, not yet diagnosed

The deployed bundle contains no `_sentryDebugIds` and no `sourceMappingURL`, so
production stack traces are not symbolicated. Two candidate causes, not yet
separated: the Sentry plugin's auth token may not reach an off-platform build
(which moving the build would fix), or `withSentryConfig` is configured under a
`webpack:` key while the build runs Turbopack (the bundle sets a `turbopack`
tag), which moving the build would not fix. Recheck after the move before
diagnosing further.

Skew Protection is also off — deployed assets carry no `?dpl=` parameter,
because Next bakes `deploymentId` from `VERCEL_DEPLOYMENT_ID` at build. Moving
the build back to Vercel restores it without further work.
