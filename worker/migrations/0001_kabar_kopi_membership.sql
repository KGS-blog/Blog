PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email_verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS member_identities (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('email', 'google')),
  provider_subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (provider, provider_subject),
  UNIQUE (member_id, provider)
);

CREATE TABLE IF NOT EXISTS member_auth_tokens (
  token_hash TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL CHECK (purpose IN ('email_login', 'verify_email', 'sign_in')),
  request_key TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS member_sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);

-- Satu paket nanti memberi hak baca Premium dan mengirim Info Lapangan.
-- Tidak ada tabel pembayaran pada fase gratis ini.
CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL UNIQUE REFERENCES members(id) ON DELETE CASCADE,
  package_id TEXT NOT NULL DEFAULT 'kabar-kopi-member',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'expired', 'suspended')),
  access_source TEXT NOT NULL DEFAULT 'free_beta'
    CHECK (access_source IN ('free_beta', 'manual', 'future_subscription')),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS premium_articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  language TEXT NOT NULL CHECK (language IN ('id', 'en')),
  title TEXT NOT NULL,
  teaser TEXT NOT NULL DEFAULT '',
  article_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  source_batch_id TEXT,
  generated_by TEXT NOT NULL DEFAULT 'mevo-coffee-engine',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS field_submissions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  author_display_name TEXT NOT NULL,
  original_text TEXT NOT NULL,
  publication_choice TEXT NOT NULL
    CHECK (publication_choice IN ('as_submitted', 'editor_review')),
  editing_consent INTEGER NOT NULL DEFAULT 0 CHECK (editing_consent IN (0, 1)),
  consent_version TEXT NOT NULL,
  editor_text TEXT,
  editor_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'needs_revision', 'approved', 'rejected', 'published')),
  reviewed_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  published_at TEXT,
  CHECK (publication_choice != 'editor_review' OR editing_consent = 1)
);

CREATE INDEX IF NOT EXISTS idx_premium_articles_publication
  ON premium_articles(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_submissions_member
  ON field_submissions(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_submissions_moderation
  ON field_submissions(status, created_at ASC);

CREATE TABLE IF NOT EXISTS field_submission_events (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES field_submissions(id) ON DELETE CASCADE,
  actor_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('submitted', 'revision_requested', 'approved', 'rejected', 'published', 'edited')),
  note TEXT,
  created_at TEXT NOT NULL
);
