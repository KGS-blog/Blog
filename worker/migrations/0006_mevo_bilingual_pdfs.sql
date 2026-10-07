CREATE TABLE IF NOT EXISTS mevo_report_files (
  report_key TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  pdf_blob BLOB NOT NULL,
  file_size INTEGER NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/pdf',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mevo_report_downloads (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  report_key TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('personal_research', 'business', 'education', 'media_publication', 'other')),
  newsletter_consent INTEGER NOT NULL CHECK (newsletter_consent = 1),
  usage_agreement INTEGER NOT NULL CHECK (usage_agreement = 1),
  agreement_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mevo_report_downloads_member
  ON mevo_report_downloads(member_id, created_at DESC);
