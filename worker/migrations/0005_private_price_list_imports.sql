-- Private price-list uploads and OCR suggestions, awaiting manual approval.
CREATE TABLE IF NOT EXISTS price_list_imports (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_base64 TEXT NOT NULL,
  ocr_markdown TEXT NOT NULL,
  suggestions_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'ignored', 'imported')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_list_imports_status ON price_list_imports(status, created_at DESC);
