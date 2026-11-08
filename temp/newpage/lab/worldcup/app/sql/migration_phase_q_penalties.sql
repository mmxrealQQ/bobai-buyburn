-- Phase Q — Knockout: extra time & penalty shootouts
-- ====================================================
-- KO matches can be decided after 90 min (extra time or a penalty shootout).
-- The tip game scores the PLAYED-90-MIN result only: a 1:1 that goes to pens
-- still scores everyone's draw-tips. Extra time / penalties only decide who
-- advances and feed the bonus questions (champion, etc.) — they NEVER change
-- the match-tip points.
--
-- Data model:
--   goals_home / goals_away  = 90-minute (regular) result  -> tip scoring
--   final_home / final_away  = full result incl. ET + pens -> winner & display
--                              (NULL when the match was decided inside 90 min)
--   decided_by               = 'aet' | 'pens' | NULL        -> display label
--
-- Winner everywhere (bracket advance / elimination / champion / bonus) =
--   direction of final_* when present, else direction of goals_*.
-- Penalty tally shown in the UI = final_* - goals_* (e.g. 4:5 - 1:1 = 3:4).
--
-- The scoring trigger (wc_resolve_tips / wc_score_tip) is intentionally NOT
-- touched — it keeps scoring on goals_home/goals_away.

ALTER TABLE wc_matches ADD COLUMN IF NOT EXISTS final_home INT;
ALTER TABLE wc_matches ADD COLUMN IF NOT EXISTS final_away INT;
ALTER TABLE wc_matches ADD COLUMN IF NOT EXISTS decided_by TEXT
  CHECK (decided_by IN ('aet','pens'));

-- Backfill of the two already-played R32 shootouts (DE-PY id 73, NL-MA id 87)
-- is done out-of-band via service-role PATCH so the wc_resolve_tips trigger
-- re-scores their tips from the corrected 90-min goals. See deploy notes.
