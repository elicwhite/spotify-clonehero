-- Fix RLS performance issues by replacing auth functions with subqueries
-- Migration: 20250823084154_fix_rls_performance_issue

-- Fix enchor_songs table policies
DROP POLICY IF EXISTS "Authenticated users can insert songs" ON enchor_songs;

CREATE POLICY "Authenticated users can insert songs" ON enchor_songs
  FOR INSERT WITH CHECK ((SELECT auth.role()) = 'authenticated');

COMMENT ON POLICY "Authenticated users can insert songs" ON enchor_songs IS 
  'Optimized policy using subquery to avoid row-by-row auth.role() evaluation';

-- Fix user_saved_songs table policies
DROP POLICY IF EXISTS "Users can view own saved songs" ON user_saved_songs;
DROP POLICY IF EXISTS "Users can modify own saved songs" ON user_saved_songs;

CREATE POLICY "Users can view own saved songs" ON user_saved_songs
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can modify own saved songs" ON user_saved_songs
  FOR ALL USING ((SELECT auth.uid()) = user_id);

COMMENT ON POLICY "Users can view own saved songs" ON user_saved_songs IS 
  'Optimized policy using subquery to avoid row-by-row auth.uid() evaluation';

COMMENT ON POLICY "Users can modify own saved songs" ON user_saved_songs IS 
  'Optimized policy using subquery to avoid row-by-row auth.uid() evaluation';

-- Fix user_saved_song_spans table policies
DROP POLICY IF EXISTS "Users can view own saved song spans" ON user_saved_song_spans;
DROP POLICY IF EXISTS "Users can modify own saved song spans" ON user_saved_song_spans;

CREATE POLICY "Users can view own saved song spans" ON user_saved_song_spans
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can modify own saved song spans" ON user_saved_song_spans
  FOR ALL USING ((SELECT auth.uid()) = user_id);

COMMENT ON POLICY "Users can view own saved song spans" ON user_saved_song_spans IS 
  'Optimized policy using subquery to avoid row-by-row auth.uid() evaluation';

COMMENT ON POLICY "Users can modify own saved song spans" ON user_saved_song_spans IS 
  'Optimized policy using subquery to avoid row-by-row auth.uid() evaluation';
