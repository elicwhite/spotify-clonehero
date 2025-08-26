-- Seed data for Spotify Clone Hero project
-- This file will be run after migrations to populate the database with initial data

-- Insert some sample songs
INSERT INTO enchor_songs (hash, name, artist, charter) VALUES
  ('hash1', 'Bohemian Rhapsody', 'Queen', 'Official'),
  ('hash2', 'Stairway to Heaven', 'Led Zeppelin', 'Official'),
  ('hash3', 'Hotel California', 'Eagles', 'Official'),
  ('hash4', 'Sweet Child O Mine', 'Guns N Roses', 'Official'),
  ('hash5', 'Wonderwall', 'Oasis', 'Official')
ON CONFLICT (hash) DO NOTHING;

-- Note: User-specific data (user_saved_songs, user_saved_song_spans) 
-- will be populated when users actually interact with the application
