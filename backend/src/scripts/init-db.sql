CREATE TABLE IF NOT EXISTS users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(320) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title VARCHAR(500) NOT NULL DEFAULT 'New conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  message_count INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_messages_session FOREIGN KEY (session_id) REFERENCES sessions (session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS raw_chunks (
  chunk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID,
  text TEXT NOT NULL,
  metadata JSONB,
  CONSTRAINT fk_raw_chunks_message FOREIGN KEY (message_id) REFERENCES messages (message_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS buckets (
  bucket_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical VARCHAR(500) NOT NULL,
  normalized VARCHAR(500) NOT NULL,
  strength DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  importance INT NOT NULL DEFAULT 5,
  concept_type VARCHAR(50) NOT NULL DEFAULT 'fact',
  last_accessed TIMESTAMPTZ NOT NULL DEFAULT now(),
  access_count INT NOT NULL DEFAULT 1,
  decay_rate DOUBLE PRECISION NOT NULL DEFAULT 0.15,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bucket_items (
  item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id UUID NOT NULL,
  label VARCHAR(500) NOT NULL,
  definition TEXT,
  source TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_bucket_items_bucket FOREIGN KEY (bucket_id) REFERENCES buckets (bucket_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS embeddings (
  embedding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id UUID NOT NULL,
  vector VECTOR(1024) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_embeddings_bucket FOREIGN KEY (bucket_id) REFERENCES buckets (bucket_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS relationships (
  relationship_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_bucket VARCHAR(500) NOT NULL,
  target_bucket VARCHAR(500) NOT NULL,
  relation_type VARCHAR(50) NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  source_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_relationship UNIQUE (source_bucket, target_bucket, relation_type)
);

CREATE TABLE IF NOT EXISTS documents (
  document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename VARCHAR(500) NOT NULL,
  file_type VARCHAR(50) NOT NULL,
  content TEXT,
  content_hash VARCHAR(64),
  s3_key VARCHAR(1000),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reminders (
  reminder_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  message TEXT NOT NULL,
  memories JSONB,
  dismissed BOOLEAN NOT NULL DEFAULT false,
  action_taken VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_reminders_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contradictions (
  contradiction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  existing_bucket_id UUID NOT NULL,
  new_information TEXT NOT NULL,
  conflict_description TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_contradictions_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT fk_contradictions_bucket FOREIGN KEY (existing_bucket_id) REFERENCES buckets (bucket_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS processing_jobs (
  job_id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  file_id UUID,
  filename VARCHAR(500) NOT NULL,
  file_type VARCHAR(50) NOT NULL,
  format VARCHAR(50) NOT NULL,
  mime_type VARCHAR(255),
  size_bytes BIGINT NOT NULL DEFAULT 0,
  s3_key VARCHAR(1000),
  status VARCHAR(50) NOT NULL DEFAULT 'queued',
  stage VARCHAR(50) NOT NULL DEFAULT 'uploaded',
  progress INT NOT NULL DEFAULT 0,
  message TEXT,
  result JSONB,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT fk_processing_jobs_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT fk_processing_jobs_file FOREIGN KEY (file_id) REFERENCES documents (document_id) ON DELETE SET NULL
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS upload_count INT NOT NULL DEFAULT 0;

ALTER TABLE buckets ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE buckets ADD COLUMN IF NOT EXISTS document_id UUID;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS s3_key VARCHAR(1000);

ALTER TABLE raw_chunks ADD COLUMN IF NOT EXISTS document_id UUID;
ALTER TABLE raw_chunks ALTER COLUMN message_id DROP NOT NULL;

ALTER TABLE relationships ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE relationships ADD COLUMN IF NOT EXISTS source_bucket_id UUID;
ALTER TABLE relationships ADD COLUMN IF NOT EXISTS target_bucket_id UUID;
ALTER TABLE relationships ADD COLUMN IF NOT EXISTS metadata JSONB;

ALTER TABLE buckets ADD CONSTRAINT fk_buckets_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE;
ALTER TABLE buckets ADD CONSTRAINT fk_buckets_document FOREIGN KEY (document_id) REFERENCES documents (document_id) ON DELETE SET NULL;

ALTER TABLE documents ADD CONSTRAINT fk_documents_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE;

ALTER TABLE raw_chunks ADD CONSTRAINT fk_raw_chunks_document FOREIGN KEY (document_id) REFERENCES documents (document_id) ON DELETE CASCADE;

ALTER TABLE relationships ADD CONSTRAINT fk_relationships_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE;
ALTER TABLE relationships ADD CONSTRAINT fk_relationships_source_bucket FOREIGN KEY (source_bucket_id) REFERENCES buckets (bucket_id) ON DELETE CASCADE;
ALTER TABLE relationships ADD CONSTRAINT fk_relationships_target_bucket FOREIGN KEY (target_bucket_id) REFERENCES buckets (bucket_id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS document_links (
  user_id UUID NOT NULL,
  source_document_id UUID NOT NULL,
  target_document_id UUID NOT NULL,
  correlation_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  shared_bucket_count INT NOT NULL DEFAULT 0,
  edge_count INT NOT NULL DEFAULT 0,
  avg_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source_document_id, target_document_id),
  CONSTRAINT fk_document_links_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT fk_document_links_source FOREIGN KEY (source_document_id) REFERENCES documents (document_id) ON DELETE CASCADE,
  CONSTRAINT fk_document_links_target FOREIGN KEY (target_document_id) REFERENCES documents (document_id) ON DELETE CASCADE,
  CONSTRAINT chk_document_links_no_self CHECK (source_document_id <> target_document_id),
  CONSTRAINT chk_document_links_score CHECK (correlation_score >= 0 AND correlation_score <= 1),
  CONSTRAINT chk_document_links_confidence CHECK (avg_confidence >= 0 AND avg_confidence <= 1)
);

UPDATE buckets SET user_id = (SELECT user_id FROM users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
UPDATE documents SET user_id = (SELECT user_id FROM users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;

UPDATE relationships r SET source_bucket_id = b.bucket_id FROM buckets b WHERE r.source_bucket = b.canonical AND r.source_bucket_id IS NULL;
UPDATE relationships r SET target_bucket_id = b.bucket_id FROM buckets b WHERE r.target_bucket = b.canonical AND r.target_bucket_id IS NULL;
UPDATE relationships r SET user_id = b.user_id FROM buckets b WHERE r.source_bucket_id = b.bucket_id AND r.user_id IS NULL;
UPDATE relationships r SET user_id = b.user_id FROM buckets b WHERE r.target_bucket_id = b.bucket_id AND r.user_id IS NULL;

DROP INDEX IF EXISTS idx_buckets_normalized;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_sandbox ON users (is_sandbox, expires_at) WHERE is_sandbox = true;

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages (session_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_raw_chunks_message_id ON raw_chunks (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raw_chunks_document_id ON raw_chunks (document_id) WHERE document_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_buckets_user_normalized ON buckets (user_id, normalized) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_buckets_null_normalized ON buckets (normalized) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_buckets_strength ON buckets (strength DESC);
CREATE INDEX IF NOT EXISTS idx_buckets_concept_type ON buckets (concept_type);
CREATE INDEX IF NOT EXISTS idx_buckets_last_accessed ON buckets (last_accessed DESC);
CREATE INDEX IF NOT EXISTS idx_buckets_importance ON buckets (importance DESC);
CREATE INDEX IF NOT EXISTS idx_buckets_user_id ON buckets (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_buckets_document_id ON buckets (document_id) WHERE document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_buckets_user_document ON buckets (user_id, document_id) WHERE user_id IS NOT NULL AND document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bucket_items_bucket_id ON bucket_items (bucket_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_bucket_id ON embeddings (bucket_id);

CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships (source_bucket);
CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships (target_bucket);
CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships (relation_type);
CREATE INDEX IF NOT EXISTS idx_relationships_confidence ON relationships (confidence DESC);
CREATE INDEX IF NOT EXISTS idx_relationships_user_id ON relationships (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_relationships_source_bucket_id ON relationships (source_bucket_id) WHERE source_bucket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_relationships_target_bucket_id ON relationships (target_bucket_id) WHERE target_bucket_id IS NOT NULL;
 

CREATE INDEX IF NOT EXISTS idx_documents_uploaded_at ON documents (uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_s3_key ON documents (s3_key) WHERE s3_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents (content_hash) WHERE content_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_user_content_hash ON documents (user_id, content_hash) WHERE user_id IS NOT NULL AND content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_user_uploaded_at ON documents (user_id, uploaded_at DESC) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON reminders (user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_dismissed ON reminders (dismissed);
CREATE INDEX IF NOT EXISTS idx_reminders_created_at ON reminders (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contradictions_user_id ON contradictions (user_id);
CREATE INDEX IF NOT EXISTS idx_contradictions_resolved ON contradictions (resolved);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_user_status ON processing_jobs (user_id, status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_started_at ON processing_jobs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_document_links_user_source ON document_links (user_id, source_document_id, correlation_score DESC);
CREATE INDEX IF NOT EXISTS idx_document_links_user_target ON document_links (user_id, target_document_id, correlation_score DESC);
CREATE INDEX IF NOT EXISTS idx_document_links_updated_at ON document_links (updated_at DESC);

CREATE VECTOR INDEX IF NOT EXISTS idx_embeddings_vector ON embeddings (vector);
-- MISSING INDEXES for bulk write performance
CREATE INDEX IF NOT EXISTS idx_relationships_source_target_type
  ON relationships (source_bucket_id, target_bucket_id, relation_type)
  WHERE source_bucket_id IS NOT NULL AND target_bucket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_buckets_normalized_lookup
  ON buckets (normalized) INCLUDE (bucket_id, user_id);

CREATE INDEX IF NOT EXISTS idx_buckets_user_normalized_lookup
  ON buckets (user_id, normalized) INCLUDE (bucket_id)
  WHERE user_id IS NOT NULL;