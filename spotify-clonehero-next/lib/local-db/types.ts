import {Kysely} from 'kysely';

// Spotify Library Tables
export interface SpotifyPlaylists {
  id: string;
  snapshot_id: string;
  name: string;
  collaborative: boolean;
  owner_display_name: string;
  owner_external_url: string;
  total_tracks: number;
  updated_at: string;
}

export interface SpotifyPlaylistTracks {
  id: string;
  playlist_id: string;
  track_id: string;
}

export interface SpotifyAlbums {
  id: string;
  name: string;
  artist_name: string;
  total_tracks: number;
  updated_at: string;
}

export interface SpotifyAlbumTracks {
  id: string;
  album_id: string;
  track_id: string;
  updated_at: string;
}

export interface SpotifyTracks {
  id: string;
  name: string;
  artist: string;
  updated_at: string;
}

// Database Schema
export interface Database {
  spotify_playlists: SpotifyPlaylists;
  spotify_playlist_tracks: SpotifyPlaylistTracks;
  spotify_albums: SpotifyAlbums;
  spotify_album_tracks: SpotifyAlbumTracks;
  spotify_tracks: SpotifyTracks;
}

export type LocalDb = Kysely<Database>;
