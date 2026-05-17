-- $BOBAI Worldcup '26 — Phase H: wallet signature columns
-- Adds storage for ECDSA signature + signed message + timestamp on wc_users.
-- The user produces this signature in their own wallet (MetaMask, Trust, hardware, etc.);
-- client-side ethers.verifyMessage prevents bad data, but the authoritative check
-- happens server-side via a Cloudflare Worker before any payout.

ALTER TABLE wc_users
  ADD COLUMN IF NOT EXISTS wallet_signature TEXT,
  ADD COLUMN IF NOT EXISTS wallet_message   TEXT,
  ADD COLUMN IF NOT EXISTS wallet_signed_at TIMESTAMPTZ;

-- Re-grant updates on the new columns to authenticated role (RLS still gates per-row).
GRANT UPDATE (wallet, wallet_signature, wallet_message, wallet_signed_at, avatar_country)
  ON wc_users TO authenticated;
