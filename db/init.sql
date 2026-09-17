CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  display_name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
  study_time TEXT NOT NULL DEFAULT '19:00',
  midweek_day INTEGER NOT NULL DEFAULT 3,
  weekend_day INTEGER NOT NULL DEFAULT 6,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS weekly_material (
  id TEXT PRIMARY KEY,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  meeting TEXT NOT NULL,
  title TEXT,
  payload JSONB NOT NULL,
  validated BOOLEAN NOT NULL DEFAULT false,
  source_hash TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  node_versions JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  source_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  source_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  saved BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saved_comments (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  source_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback_cases (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  node_version TEXT NOT NULL,
  rating TEXT NOT NULL,
  reason TEXT,
  correction TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS node_candidates (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  base_version TEXT NOT NULL,
  candidate_version TEXT NOT NULL,
  yaml TEXT NOT NULL,
  evaluation JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memory_embedding_idx ON memory_items USING hnsw (embedding vector_cosine_ops);
