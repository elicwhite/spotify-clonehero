-- Drop difficulty column from user_saved_song_spans and adjust uniques/indexes if needed
BEGIN;

-- Drop check/default by dropping the column
ALTER TABLE public.user_saved_song_spans
  DROP COLUMN IF EXISTS difficulty;

-- Ensure unique constraint does not include difficulty (original unique was on tick fields)
-- If an old unique including difficulty existed, drop it safely (name unknown)
-- We rely on original schema using UNIQUE(user_id, song_hash, start_tick, end_tick)
-- so nothing to change here beyond column drop.

COMMIT;


