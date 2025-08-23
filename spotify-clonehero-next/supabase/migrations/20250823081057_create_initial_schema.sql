-- Create initial schema for Spotify Clone Hero project
-- Migration: 20250823081057_create_initial_schema

CREATE TABLE enchor_songs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  hash TEXT NOT NULL,
  name TEXT NOT NULL,
  artist TEXT NOT NULL,
  charter TEXT,

  UNIQUE(hash)
);

CREATE INDEX idx_enchor_songs_hash ON enchor_songs(hash);


CREATE TABLE user_saved_songs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  song_hash TEXT REFERENCES enchor_songs(hash) ON DELETE CASCADE,
  difficulty TEXT DEFAULT 'expert' CHECK (difficulty IN ('expert', 'hard', 'medium', 'easy')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(user_id, song_hash)
);

-- Indexes for performance
CREATE INDEX idx_user_saved_songs_user_id ON user_saved_songs(user_id);


CREATE TABLE user_saved_song_spans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  song_hash TEXT REFERENCES enchor_songs(hash) ON DELETE CASCADE,
  start_tick INTEGER,
  end_tick INTEGER,
  difficulty TEXT DEFAULT 'expert' CHECK (difficulty IN ('expert', 'hard', 'medium', 'easy')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure valid time ranges
  CHECK (start_tick < end_tick),

  UNIQUE(user_id, song_hash, start_tick, end_tick)
);

-- Indexes for performance
CREATE INDEX idx_user_saved_song_spans_user_id ON user_saved_song_spans(user_id);
CREATE INDEX idx_user_saved_song_spans_song_hash ON user_saved_song_spans(song_hash);
CREATE INDEX idx_user_saved_song_spans_tick_range ON user_saved_song_spans(start_tick, end_tick);


ALTER TABLE enchor_songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_saved_songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_saved_song_spans ENABLE ROW LEVEL SECURITY;

-- Anyone can read songs
CREATE POLICY "Songs are viewable by everyone" ON enchor_songs
  FOR SELECT USING (true);

-- Only authenticated users can insert songs
CREATE POLICY "Authenticated users can insert songs" ON enchor_songs
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Users can only see their own saved songs
CREATE POLICY "Users can view own saved songs" ON user_saved_songs
  FOR SELECT USING (auth.uid() = user_id);

-- Users can only modify their own saved songs
CREATE POLICY "Users can modify own saved songs" ON user_saved_songs
  FOR ALL USING (auth.uid() = user_id);

-- Users can only see their own saved song spans
CREATE POLICY "Users can view own saved song spans" ON user_saved_song_spans
  FOR SELECT USING (auth.uid() = user_id);

-- Users can only modify their own saved song spans
CREATE POLICY "Users can modify own saved song spans" ON user_saved_song_spans
  FOR ALL USING (auth.uid() = user_id);