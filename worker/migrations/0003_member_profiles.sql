-- Member identity login is separate from membership activation. New and
-- existing accounts must complete this profile before member-only access.
ALTER TABLE members ADD COLUMN member_role TEXT
  CHECK (member_role IS NULL OR member_role IN ('petani', 'prosesor', 'marketing', 'student', 'lainnya'));
ALTER TABLE members ADD COLUMN role_other TEXT;
ALTER TABLE members ADD COLUMN newsletter_opt_in INTEGER NOT NULL DEFAULT 0
  CHECK (newsletter_opt_in IN (0, 1));
ALTER TABLE members ADD COLUMN profile_completed_at TEXT;
