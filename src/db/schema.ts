export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS remote_connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_connected_at TEXT
);

CREATE TABLE IF NOT EXISTS model_provider_settings (
  provider_id TEXT PRIMARY KEY,
  secret_ciphertext TEXT,
  enabled_models_json TEXT NOT NULL DEFAULT '[]',
  catalog_json TEXT NOT NULL DEFAULT '[]',
  catalog_source TEXT,
  catalog_discovered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  execution_target TEXT NOT NULL DEFAULT 'local',
  workspace_path TEXT NOT NULL DEFAULT '',
  remote_connection_id TEXT,
  ssh_host TEXT,
  ssh_port INTEGER,
  ssh_username TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  active_node_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES nodes(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  kind TEXT NOT NULL CHECK (kind IN ('message','clarification','plan','status')),
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_conversation ON nodes(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_node_id TEXT NOT NULL REFERENCES nodes(id),
  assistant_node_id TEXT REFERENCES nodes(id),
  status TEXT NOT NULL CHECK (status IN ('queued','running','settled','failed','cancelled')),
  model TEXT NOT NULL,
  error TEXT,
  started_at TEXT,
  settled_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_conversation ON runs(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, id);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  args_json TEXT NOT NULL,
  result_json TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  node_id TEXT REFERENCES nodes(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  UNIQUE(conversation_id, version)
);

CREATE TABLE IF NOT EXISTS plan_steps (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT,
  started_at TEXT,
  finished_at TEXT,
  UNIQUE(plan_id, step_key)
);

CREATE TABLE IF NOT EXISTS citations (
  id TEXT PRIMARY KEY,
  node_id TEXT REFERENCES nodes(id),
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  locator TEXT,
  url TEXT,
  evidence_text TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_citations_run ON citations(run_id);
CREATE INDEX IF NOT EXISTS idx_citations_node ON citations(node_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  plan_id TEXT REFERENCES plans(id),
  step_id TEXT,
  path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rag_documents (
  id TEXT PRIMARY KEY,
  card_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  embedding_model TEXT,
  embedding_dimensions INTEGER,
  embedding BLOB,
  indexed_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS rag_fts USING fts5(
  id UNINDEXED,
  title,
  content,
  source_ids,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS rag_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
