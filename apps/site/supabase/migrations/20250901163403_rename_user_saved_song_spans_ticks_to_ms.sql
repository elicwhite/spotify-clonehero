-- Rename columns from ticks to milliseconds in user_saved_song_spans
-- Note: Dependent constraints and indexes will update automatically to reference new columns.

BEGIN;

ALTER TABLE public.user_saved_song_spans
  RENAME COLUMN start_tick TO start_ms;

ALTER TABLE public.user_saved_song_spans
  RENAME COLUMN end_tick TO end_ms;

-- Optionally rename the existing index to reflect new column names, if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_user_saved_song_spans_tick_range'
  ) THEN
    EXECUTE 'ALTER INDEX public.idx_user_saved_song_spans_tick_range RENAME TO idx_user_saved_song_spans_ms_range';
  END IF;
END $$;

COMMIT;


