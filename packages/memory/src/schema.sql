-- Episodic: raw session logs
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,            -- Managed Agents session ID
  created_at   TIMESTAMPTZ DEFAULT now(),
  user_message TEXT NOT NULL,
  agent_reply  TEXT NOT NULL,
  tools_called TEXT[],
  duration_ms  INT,
  cost_usd     NUMERIC(8, 4),
  feedback     SMALLINT,                    -- +1 thumbs up, -1 thumbs down
  was_corrected BOOLEAN DEFAULT FALSE
);

-- Semantic: facts and preferences
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memories (
  id         BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  text       TEXT NOT NULL,                 -- Human-readable fact
  embedding  VECTOR(1024),                  -- voyage-3-lite outputs 1024-dimensional vectors
  source_id  TEXT,                          -- Session that produced this
  category   TEXT,                          -- 'fact' | 'preference' | 'correction' | 'pattern' | 'style'
  confidence REAL DEFAULT 1.0
);

CREATE INDEX IF NOT EXISTS memories_embedding_idx
  ON memories USING ivfflat (embedding vector_cosine_ops);

-- Working style profile (single-row, updated nightly)
CREATE TABLE IF NOT EXISTS working_style (
  id                 INT PRIMARY KEY DEFAULT 1,
  updated_at         TIMESTAMPTZ DEFAULT now(),
  peak_hours         TEXT,                  -- e.g. "9-11am, 3-5pm ET"
  format_preference  TEXT,                  -- e.g. "bullets for tasks, prose for analysis"
  avg_message_length INT,                   -- chars
  top_task_types     TEXT[],               -- ['email', 'research', 'scheduling']
  frequent_contacts  TEXT[],               -- ['Sarah', 'the board']
  domain_terms       TEXT[],               -- ['ARR', 'ICP', 'GTM']
  confirm_before     TEXT[],               -- ['send email', 'create calendar event']
  tools_by_frequency JSONB,               -- { gmail: 42, gcal: 18, notion: 8 }
  feedback_patterns  JSONB                -- { thumbs_up_triggers: [...] }
);

INSERT INTO working_style (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Hour-of-day activity counter (for peak hours inference)
CREATE TABLE IF NOT EXISTS session_hours (
  hour  SMALLINT PRIMARY KEY,              -- 0-23
  count INT DEFAULT 0
);

-- Dead letter queue for failed sessions
CREATE TABLE IF NOT EXISTS dlq (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT now(),
  payload       JSONB NOT NULL,
  attempts      INT DEFAULT 0,
  next_retry_at TIMESTAMPTZ DEFAULT now()
);
