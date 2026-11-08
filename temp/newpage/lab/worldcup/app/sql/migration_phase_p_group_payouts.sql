-- Phase P: Group pot payout tracking
--
-- 1. wc_payouts: per-transfer row written by the payout CLI script
--    (one row per winner per pot). End-pool/Crypto payouts use the same table.
-- 2. wc_pool.group_paid_at: single timestamp that gates the "paid out" UI
--    state across the worldcup app. Set by /admin/mark-group-paid after the
--    payout script finishes successfully.

-- =====================================================================
-- 1) wc_payouts — receipt rows
-- =====================================================================
CREATE TABLE IF NOT EXISTS wc_payouts (
  id              BIGSERIAL PRIMARY KEY,
  pot             TEXT        NOT NULL CHECK (pot IN ('group', 'end', 'crypto')),
  group_letter    TEXT        CHECK (group_letter IS NULL OR group_letter ~ '^[A-L]$'),
  position        TEXT        NOT NULL,        -- '1st' | '2nd' | 'best_3rd' | 'overall_1st' | 'overall_2nd' | 'overall_3rd' | 'overall_4th' | 'btc' | 'bnb' | 'bobai'
  user_id         BIGINT REFERENCES wc_users(id) ON DELETE SET NULL,
  username        TEXT        NOT NULL,        -- snapshot at payout time
  country_code    TEXT,                        -- snapshot at payout time
  wallet          TEXT        NOT NULL,        -- BEP-20 address (lowercased)
  bobai_amount    NUMERIC(38, 8) NOT NULL,
  usd_at_payout   NUMERIC(14, 2),
  tx_hash         TEXT,                        -- 0x… BscScan tx
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes           TEXT                         -- e.g. "26x cap applied", "redistributed share"
);

-- Common read patterns:
CREATE INDEX IF NOT EXISTS wc_payouts_pot_idx          ON wc_payouts (pot);
CREATE INDEX IF NOT EXISTS wc_payouts_group_letter_idx ON wc_payouts (group_letter) WHERE group_letter IS NOT NULL;
CREATE INDEX IF NOT EXISTS wc_payouts_user_idx         ON wc_payouts (user_id)      WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS wc_payouts_paid_at_idx      ON wc_payouts (paid_at DESC);

-- Public read access (TX hashes + amounts are on-chain anyway, no PII beyond
-- wallet which is also on-chain). Insert is service-role only.
ALTER TABLE wc_payouts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "public read wc_payouts" ON wc_payouts FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================================
-- 2) wc_pool.group_paid_at — the global "paid" gate
-- =====================================================================
ALTER TABLE wc_pool
  ADD COLUMN IF NOT EXISTS group_paid_at TIMESTAMPTZ;
