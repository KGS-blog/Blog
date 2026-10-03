-- Reports uploaded by the MEVO report process are separate from the public
-- editorial articles stored in premium_articles.
CREATE TABLE IF NOT EXISTS mevo_member_reports (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  language TEXT NOT NULL CHECK (language IN ('id', 'en')),
  title TEXT NOT NULL,
  teaser TEXT NOT NULL DEFAULT '',
  report_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  source_batch_id TEXT,
  generated_by TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mevo_member_reports_publication
  ON mevo_member_reports(status, published_at DESC);
