# 0097 — Apple Music in Find Music

Status: implementation complete — automated validation and guest browser smoke
passed; authenticated Apple Music validation pending

## Contrarian review disposition

The contrarian review rejected the first draft because it assumed the
cross-origin-isolated page could reuse MusicKit authorization, relied on a
navigation click to authorize in a later document, overstated the privacy
boundary, persisted unstable preview URLs, collapsed version-specific
destinations through normalized identity, and did not align Radar's SQL
pre-ranking with its proposed score.

This revision accepts the engineering findings. It adds an explicit
connector-page click, an isolation feasibility gate before schema work, lazy
catalog actions keyed by catalog ID, staging cleanup, version-safe action
selection, route/data leakage guards, and aligned recommendation ranking.

The product owner reviewed Apple's MusicKit/App Store guidance, accepts that
this use is in a gray area, and has decided to ship it. Contract interpretation
is therefore a recorded product risk rather than a blocker for this task.

## Outcome

Make Apple Music a production-quality, browser-local taste source in
`/find-music`. A visitor may use Spotify only, Apple Music only, or both. Apple
Music remains independent of Supabase authentication: the application server
signs only the non-personalized developer token, while MusicKit authorization,
library requests, matching, and persistence stay in the browser.

The integration must preserve all existing Spotify behavior and make provider
capabilities explicit. Apple catalog resources may provide canonical Apple
Music URLs and optional preview assets. Those capabilities are resolved lazily,
feature-detected, and never assumed. When both providers are available, the UI
will preserve both unambiguous destinations without duplicating the song or its
Chorus matches.

## Product decisions

- The action is **Connect Apple Music**, not site login. It neither creates nor
  links a Supabase account.
- Apple Music authorization and locally cached library rows belong to this
  browser profile. **Disconnect Apple Music** invalidates MusicKit authorization
  and deletes the local Apple source rows.
- Spotify and Apple Music remain independent sources. A failure or disconnect
  in one must not remove, hide, or block the other.
- Direct-song results deduplicate by the existing normalized artist/title
  identity. Evidence from both providers is retained and scored; it does not
  duplicate rows or charts.
- Discovery recommendations use both listening-history affinity and library
  breadth. Apple-only and Spotify-library-only users therefore receive Radar
  results instead of requiring Spotify history.
- Apple catalog metadata is best-effort. A library song without a catalog
  association still participates in local Chorus matching, but lacks a direct
  Apple action unless a later explicit search produces an unambiguous match.
- The browser stores only the metadata required for matching and actions:
  optional catalog ID, original artist/title, normalized matching forms,
  storefront, scan counts, and timestamps. Apple library IDs, tokens, artwork,
  canonical URLs, preview URLs, raw responses, and full payloads are not
  persisted or sent to the application server.
- Browser-local Apple data is browser-profile data, not data owned by the
  current Supabase user. The same shared-browser boundary already applies to
  locally cached Spotify libraries and Spotify history. A provider-neutral
  lifecycle, disclosure, and account-handoff design is tracked separately in
  plan 0098 and does not block this integration. This task still provides an
  explicit Apple disconnect-and-clear action.
- A first visit to `/find-music` performs only a read-only OPFS existence
  check. When the local database does not exist, the page must not construct
  SQLocal, run migrations, configure MusicKit, query snapshots, or download
  the Chorus catalog until the visitor explicitly starts a source action.
  Returning visitors may read an existing local database, but merely opening
  the page must not refresh or populate Chorus. A connect navigation carries a
  one-shot, tab-scoped activation marker so work can resume after the provider
  round trip without turning future page loads into implicit consent.

## Architecture

### Authorization under the SQLocal header constraint

`/find-music` is cross-origin isolated so SQLocal can use its OPFS/SQLite
worker. MusicKit authorization needs an opener-compatible page and cannot
reliably launch from that isolation policy.

Add a minimal `/apple-music-connect` route with an exact non-isolated COOP/COEP
override. The `/find-music` Apple connect action uses
`window.location.assign`, not Next client navigation, so the browser creates a
document with the new policy. The connector accepts only a validated internal
return path and:

1. loads and configures MusicKit using the developer-token endpoint;
2. reuses an existing valid MusicKit authorization when available;
3. otherwise renders an explicit **Continue with Apple Music** button after
   MusicKit is ready and calls `authorize()` only from that new user gesture;
4. returns with a full-document navigation after success;
5. displays actionable retry/cancel errors without exposing tokens or payloads.

The connector route loads no Supabase auth provider, analytics, WebMCP tools,
session replay, or Sentry initialization on an initial document load.
`/find-music` then configures MusicKit, observes the restored `isAuthorized`
state, and performs personalized API calls directly to Apple. It never calls
`authorize()` under `COOP: same-origin`; authorization failures hard-navigate
back to the connector. No personalized request passes through a Next.js route.

Before local-schema work, perform a feasibility spike in Chromium and Safari:
prove that the cross-origin-isolated `/find-music` document can load/configure
MusicKit, restore authorization, call `/v1/me/...`, resolve catalog metadata,
and recover from revoked authorization. If this fails, stop: doing all MusicKit
work in the non-isolated connector would require a separately reviewed storage
and communication architecture rather than weakening `/find-music` headers.

The Chromium isolation gate passed on 2026-08-08: `/find-music` remained
cross-origin isolated, restored Apple Music authorization, and read a 25-song
personalized library page without saving it. Safari remains part of the final
manual launch-validation matrix rather than an implementation blocker.

### Shared MusicKit client boundary

Use a shared `lib/apple-music` client with a small typed surface:

- singleton, retryable SDK loading and configuration;
- `isAuthorized`, `authorize`, and `unauthorize`;
- storefront lookup;
- serial library-song pagination by following Apple's returned `next` paths;
- user-initiated catalog-song resolution for canonical `url` and optional
  `previews[].url`, cached in memory only for the page session;
- explicit catalog search by artist/title for rows such as Radar
  recommendations, accepting an action only when the result is unambiguous;
- response parsing isolated from React and covered with malformed/partial
  payload tests.

The adapter never exposes or persists the Music User Token. It accepts an
`AbortSignal`, checks cancellation between requests, follows returned
pagination links rather than inventing offsets, and classifies authorization,
rate-limit, transient API, malformed-response, token-expiry, and SDK-load
failures for useful UI states. Catalog action failures degrade link/preview capability without
discarding otherwise valid library matches. A refreshed developer token is
obtained proactively before expiry and once on an eligible authentication
failure; Music User Token failures are classified separately and route through
the connector.

### Local database

Add migration `016_apple_music_library` with:

- `apple_music_tracks`: local generated row ID, scan ID, optional catalog ID,
  original artist/title, normalized artist/title, and update time; indexes on
  scan, normalized identity, and catalog ID. Apple library IDs are discarded
  after response parsing.
- `apple_music_library_state`: a checked singleton active-scan pointer with
  storefront, reported total, fetched count, usable count,
  catalog-associated count, and last successful refresh time. A populated
  state with zero tracks represents a successful empty library distinctly from
  “never scanned.”

Use generation-based replacement so a refresh is atomic from the query layer:

1. create a new scan ID and write pages into that generation;
2. keep queries pinned to the previous active generation during the scan;
3. after every required library page succeeds, switch the active pointer and
   remove the old generation in one transaction; catalog resolution is not a
   scan dependency because it is lazy;
4. on cancel or failure, delete the staging generation and retain the last
   complete library;
5. on startup, delete orphaned non-active generations left by a crashed tab;
6. on disconnect, clear every Apple generation and its state.

This is additive: do not rewrite or backfill the mature Spotify ingestion
tables in this change. Provider-neutral query CTEs will combine the existing
Spotify tables with the active Apple generation. That minimizes Spotify
regression risk while establishing a clean provider boundary for later schema
consolidation.

### Refresh orchestration

Add `useAppleMusicLibraryUpdate` alongside `useSpotifyLibraryUpdate`, with
independent progress, cancellation, completion, and error state. It will:

- configure MusicKit and surface restored authorization;
- fetch every library-song page serially;
- validate and normalize each usable row;
- extract catalog IDs without fetching or retaining extra catalog metadata;
- report fetched, usable, catalog-associated, and reported-total progress;
- stage database rows and atomically activate a complete scan;
- preserve the previous scan on failure;
- trigger the existing held-snapshot/re-rank mechanism as local data changes.

Apple refresh never requires a Supabase user. Spotify refresh keeps its current
Supabase identity/token flow unchanged. Chorus refresh begins when any of
Spotify history, Spotify library, or active Apple library has taste rows.

### Queries, evidence, and scoring

Refactor `app/find-music/queries.ts` so its identity inputs are provider-aware:

- direct songs union Spotify history, Spotify library tracks, and active Apple
  tracks before collapsing normalized identities;
- Spotify destinations and version-specific Apple catalog IDs survive
  aggregation without selecting an arbitrary normalized match;
- Spotify playlist/album labels remain attached only to Spotify evidence;
- Apple library membership becomes its own evidence field;
- active Apple rows are included in direct-song exclusion for Radar;
- artist affinity aggregates Spotify history play counts separately from the
  distinct normalized songs present in Spotify and/or Apple libraries, with
  provider duplicates counting once.

Extend result types and scoring with explicit evidence rather than pretending
Apple library membership is Spotify history. Direct-song scoring keeps the
existing history cap of 55, Spotify playlist cap of 24, Spotify saved-album cap
of 20, Apple saved-library membership worth 20, and installed-chart point of 1,
with the final total capped at 100. Songs found in both services appear once.

Radar labels the new signal **Saved-library coverage**, never listening or
artist affinity. It deduplicates normalized library songs across providers,
caps saved-library contribution at 25, preserves history play contribution at
55, and retains chart/instrument/freshness support under the final 100 cap. The
SQL candidate pre-rank uses the same history and library fields as JavaScript
scoring and deliberately overfetches before applying the public limit so
library-heavy candidates cannot be starved by the old history-only order.
Normalization remains fuzzy Chorus evidence only: provider IDs and original
version labels are retained while scanning, and media destinations are never
chosen merely because two normalized identities collide.

Stats become provider-specific (`spotifyLibraryTracks`,
`appleMusicLibraryTracks`, independent timestamps/storefront) plus the combined
values needed for page gating. Empty/welcome decisions consider either source.

### Source UI and media actions

Replace the single generic “library” source status in `/find-music` with
independent Spotify Library and Apple Music cards in both Welcome and Sidebar.
Each shows its own connection, progress, errors, counts, refresh action, and
privacy/account wording. Apple exposes a disconnect/clear action; Spotify
connection behavior is unchanged.

Replace the table's Spotify-only `previewEnabled` switch with a provider-action
union carrying provider, optional catalog ID, known URL, and preview capability.
Direct Apple rows use their catalog ID. Radar or other rows without one perform
a cached, explicit catalog search. Spotify keeps its current lazy lookup and
exact Spotify-track resolution.

The media cell exposes exactly one preview control per song. When both services
are connected, its default provider is whichever complete saved-library scan
contains more songs; Spotify wins a tie. If the preferred provider has no
unambiguous match, has no preview asset, fails lookup, or fails playback, the
same action automatically tries the other connected provider. The successful
provider determines the icon and canonical link-out, so the UI never asks the
user to choose between duplicate preview buttons.

The media cell will:

- resolve Apple previews only on user action, keep preview URLs in memory, pair
  playback with the canonical Apple destination, and never loop Apple assets;
- retain Spotify preview behavior and Spotify link-outs;
- show canonical Apple Music link-outs only when resolved unambiguously;
- isolate lookup and playback failures per provider and automatically try the
  other provider;
- stop playback when filters remove the active row, as today;
- never imply that an unavailable preview means the song is absent from the
  user's library.

## Implementation sequence

1. Build the shared MusicKit loader/client/parser; add parser, singleton,
   retry, and error tests.
2. Add `/apple-music-connect`, the explicit ready-state button, full-document
   safe-return routing, route privacy exclusions, and header tests.
3. Run the isolation feasibility spike. Do not continue to persistence if
   restored personalized requests fail under `/find-music` headers.
4. Add migration 016, generated DB types, Apple local repository functions,
   generation activation/rollback/clear logic, and migration/repository tests.
5. Build full pagination and the Apple refresh hook with cancellation,
   prior-scan preservation, progress, and malformed response coverage.
6. Refactor find-music result types, queries, stats, Radar coverage, scoring,
   deduplication, and evidence copy for Spotify-only, Apple-only, and combined
   fixtures.
7. Add independent source cards and orchestration to FindMusic Client, Welcome,
   and Sidebar, including connect, refresh, retry, disconnect, and clear flows.
8. Add lazy Apple preview/link actions and one dual-provider preview control,
   preserving Spotify lookup and AudioProvider concurrency behavior while
   selecting the larger saved library by default and failing over automatically.
9. Guard Apple tables from raw-SQL/WebMCP exposure, suppress Apple-route error
   payload capture, and verify no logging includes music metadata.
10. Run focused tests, migration compatibility, type checks, lint/format, and a
    production build where practical.
11. Browser-validate connector authorization, restored authorization, full scan,
    refresh after adding/removing a library song, Apple-only results, both-source
    deduplication, preview/link-outs, cancellation/error recovery, disconnect
    cleanup, console errors, and network destinations.

During hardening, the unreleased connection-epoch and scan-generation changes
were folded into the canonical migration 016. The product owner cleared the
only browser profile that had run an early development schema, so no Apple Music
compatibility migrations are shipped. Fresh databases receive the final schema
directly from 016. The contrarian implementation review also led to retry-safe
preview cancellation, all-exact-action resolution, CORS-enabled media loading,
current-membership-only Spotify counts/evidence, and safe user-visible refresh
diagnostics.

Apple Music branding uses the official small RGB icon on neutral controls and
the official small white icon on Apple-colored source tiles. The checked-in SVGs
are byte-identical copies of the product-owner-provided Apple artwork.

## Test matrix

### Automated

- MusicKit SDK load/configure deduplication, retry, restored authorization, and
  connector redirect validation.
- Library pagination follows `next`, handles empty/partial resources, extracts
  catalog IDs from play parameters or catalog relationships, and honors
  cancellation; the separate lazy resolver validates canonical URLs/previews.
- Refresh failure/cancel keeps the old active generation; success switches once
  and prunes the old generation; disconnect clears all Apple rows.
- Migration upgrades a populated pre-Apple database and works from empty.
- Queries: Spotify-only, Apple-only, both with the same song, both with distinct
  songs, Apple track without catalog ID, removed Apple track after refresh, and
  no taste sources.
- Radar: history affinity, Spotify-library-only affinity, Apple-library-only
  affinity, combined dedupe, and direct-song exclusion.
- UI: unauthenticated Apple guest, authenticated Spotify-only, Apple-only,
  both, independent provider failure, refresh progress, held re-rank, and
  disconnect cleanup.
- Media actions: Apple lazy catalog lookup, missing preview with valid link,
  default-provider selection from source counts, bidirectional fallback for
  lookup/no-preview/playback failure, exactly one preview control, and
  one-track-at-a-time playback.
- Token/private-key and privacy regression tests remain green; no Apple payload
  is posted to application or Supabase routes, exposed by raw SQL/WebMCP, or
  attached to error telemetry.
- Hard navigation applies the connector headers; authorization requires the
  connector's second click; revoked authorization never triggers a popup from
  `/find-music`.
- Crash/reload removes orphan generations; an empty successful scan remains a
  valid active state; a scan exceeding developer-token lifetime renews safely.
- Ambiguous normalized identities and ambiguous catalog searches never choose
  an arbitrary Apple destination or preview.

### Manual

- Chromium and Safari with an active Apple Music subscription.
- First authorization, restored authorization, cancel, non-subscriber/error,
  disconnect, reconnect, and a different Apple account after disconnect.
- Large/multipage library and add/remove refresh behavior.
- Network inspection confirms personalized `/v1/me/...` traffic goes from the
  browser to Apple and the app server receives only the developer-token call.
- Spotify-only and dual-provider scans remain functional, including Spotify
  previews and links.

## Operational requirements

- Keep the existing server-only Team ID, Key ID, `.p8`, and allowed-origin
  configuration. Production must include the deployed origin in the signed
  developer token.
- Keep developer tokens short-lived and cached; expose no private key material.
- Document that clearing site storage removes locally cached taste data and
  that Apple authorization may need to be disconnected separately.
- The product owner has accepted the MusicKit guideline ambiguity for launch.
  Keep the deliberately conservative implementation: no artwork, minimal
  matching metadata, user-initiated catalog resolution, and canonical Apple
  link-outs accompanying Apple previews.

## Acceptance criteria

- A guest can connect Apple Music, scan the complete library, match Chorus
  charts, receive saved-library-based Radar recommendations, and resolve
  contract-enabled Apple previews/link-outs when unambiguous, without Supabase.
- Spotify-only behavior remains unchanged.
- A dual-provider user sees deduplicated songs with combined evidence and one
  preview action that prefers the larger library, then transparently falls back
  to the other provider when needed.
- Refreshes are complete, cancellable, recoverable, and never replace the last
  good Apple scan with a partial scan.
- Disconnect invalidates MusicKit and removes Apple rows/results without
  touching Spotify or history data.
- Personalized Apple requests and library metadata never pass through the
  application server or Supabase.
- Focused automated tests, migration compatibility, type checks, lint, and
  browser validation pass, with any unrelated pre-existing failures documented.
