-- Persistent absolute-timestamp state for per-model lockouts. Append-only: no
-- existing provider_connections row is mutated by this migration.
CREATE TABLE IF NOT EXISTS model_resilience_state (
  state_key          TEXT PRIMARY KEY,
  provider           TEXT NOT NULL,
  connection_id      TEXT NOT NULL,
  scope              TEXT NOT NULL CHECK (scope IN ('exact','quota_family')),
  model_scope        TEXT NOT NULL,
  reason_code        TEXT NOT NULL,
  lock_until_ms      INTEGER,
  locked_at_ms       INTEGER NOT NULL,
  failure_count      INTEGER NOT NULL,
  last_failure_at_ms INTEGER NOT NULL,
  reset_after_ms     INTEGER NOT NULL,
  last_cooldown_ms   INTEGER,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_model_resilience_state_expiry ON model_resilience_state (lock_until_ms);
CREATE INDEX IF NOT EXISTS idx_model_resilience_state_conn ON model_resilience_state (provider, connection_id);
