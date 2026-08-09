# 0098 — Browser-Profile Taste Data Lifecycle

Status: todo

## Problem

Taste-source data is persisted in the browser's shared OPFS/SQLite database.
That is true for Spotify library scans, Spotify history imports, Apple Music
library scans, and derived matches/recommendations. Supabase login state does
not establish ownership of those local rows, and changing site accounts does
not mean the person using the browser profile changed—or that the connected
Spotify or Apple Music account changed.

On a shared computer or shared browser profile, a later person can therefore
see music data cached by an earlier person. Treat this as one provider-neutral
local-data lifecycle problem rather than adding Apple-specific behavior that
would leave the existing Spotify exposure unresolved.

## Goal

Design and implement a coherent lifecycle for all locally persisted taste
sources without coupling MusicKit authorization to Supabase identity.

The future work should decide:

- whether local taste data belongs to the browser profile, an explicit local
  profile, or a namespace selected by the user;
- what login, logout, Supabase-user change, Spotify relink, Apple Music
  disconnect, and Apple-account change should do;
- how the UI discloses retained browser-local data and offers “clear this
  source” versus “clear all personal music data”;
- whether a source can be retained across site-account changes only after an
  explicit confirmation;
- how derived matches, recommendations, caches, and scan generations are
  invalidated when source rows are cleared;
- how to avoid claiming that a MusicKit authorization or local Spotify cache
  belongs to the current Supabase user;
- whether optional encryption or a dedicated browser-local profile boundary is
  warranted.

## Scope

Cover at least:

- Spotify playlists, saved albums, tracks, tokens/link state, and previews;
- Spotify extended-history imports;
- Apple Music library generations, MusicKit authorization, and catalog caches;
- derived Chorus matches and Radar recommendations;
- local analytics, Sentry/session replay, WebMCP/raw SQL, database export, and
  diagnostic tooling that could expose personal music metadata.

## Acceptance criteria

- The product has one documented browser-profile/account-handoff policy shared
  by every taste provider.
- Users can see which personal sources are retained locally and clear one or
  all of them.
- Tests cover guest-to-user, user-to-guest, user-A-to-user-B, provider relink,
  external revocation, shared-browser handoff, and storage clearing.
- Clearing a source removes its raw rows and every provider-specific derived
  cache without deleting unrelated providers unless the user chose “clear
  all.”
- UI/privacy copy accurately distinguishes site identity, provider
  authorization, and browser-local persistence.

## Relationship to plan 0097

This plan is intentionally not a prerequisite for Apple Music integration.
Plan 0097 must provide an explicit Apple disconnect-and-clear action and avoid
binding Apple data to Supabase, but the cross-provider shared-browser lifecycle
is handled here.
