CREATE TABLE IF NOT EXISTS opportunities (
  id           TEXT PRIMARY KEY,
  source       TEXT,
  number       TEXT,
  title        TEXT,
  agency       TEXT,
  agency_code  TEXT,
  status       TEXT,
  open_date    TEXT,
  close_date   TEXT,
  doc_type     TEXT,
  cfda_list    TEXT[],
  link         TEXT,
  synced_at    TIMESTAMPTZ DEFAULT NOW()
);
