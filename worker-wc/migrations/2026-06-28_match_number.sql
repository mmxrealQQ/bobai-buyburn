-- Add stable FIFA match-number identifier (73-104 = KO stage).
-- Backfill is done by the worker (/admin/backfill-match-numbers) using
-- kickoff_utc ±2h tolerance per phase, so this file only owns the schema bit.

ALTER TABLE wc_matches
  ADD COLUMN IF NOT EXISTS match_number INTEGER;

-- One FIFA number per row at most. Partial unique index allows NULLs for
-- group-stage rows we don't bother numbering.
CREATE UNIQUE INDEX IF NOT EXISTS wc_matches_match_number_uidx
  ON wc_matches (match_number)
  WHERE match_number IS NOT NULL;
