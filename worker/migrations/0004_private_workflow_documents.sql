-- Workflow state such as pending cluster candidates is stored privately in D1,
-- not in the public GitHub Pages repository.
CREATE TABLE IF NOT EXISTS kabar_workflow_documents (
  document_key TEXT PRIMARY KEY,
  document_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
