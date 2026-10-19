-- Consolidate redundant RLS policies to fix performance warnings
-- Migration: 20250823090000_consolidate_rls_policies

-- Drop redundant SELECT policies since FOR ALL already covers SELECT
DROP POLICY IF EXISTS "Users can view own saved songs" ON user_saved_songs;
DROP POLICY IF EXISTS "Users can view own saved song spans" ON user_saved_song_spans;

-- Rename the remaining policies to be more descriptive
DROP POLICY IF EXISTS "Users can modify own saved songs" ON user_saved_songs;
DROP POLICY IF EXISTS "Users can modify own saved song spans" ON user_saved_song_spans;

CREATE POLICY "Users can manage own saved songs" ON user_saved_songs
  FOR ALL USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can manage own saved song spans" ON user_saved_song_spans
  FOR ALL USING ((SELECT auth.uid()) = user_id);

COMMENT ON POLICY "Users can manage own saved songs" ON user_saved_songs IS 
  'Consolidated policy covering all operations (SELECT, INSERT, UPDATE, DELETE) for user''s own saved songs';

COMMENT ON POLICY "Users can manage own saved song spans" ON user_saved_song_spans IS 
  'Consolidated policy covering all operations (SELECT, INSERT, UPDATE, DELETE) for user''s own saved song spans';
