-- =============================================================================
-- LImax AI Manager — Migration 004: Knowledge Base RAG & AI Usage Logs
-- Status: NOT APPLIED — VPS RUNTIME REQUIRED
-- =============================================================================

CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_item_id UUID NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    language VARCHAR(10) NOT NULL DEFAULT 'uz',
    embedding vector(1536), -- Vector embedding dimension (e.g. OpenAI text-embedding-3-small or Gemini text-embedding-004)
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_item_id ON knowledge_chunks(knowledge_item_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_language ON knowledge_chunks(language);

CREATE TABLE IF NOT EXISTS ai_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL,
    model VARCHAR(100) NOT NULL,
    input_tokens INT NOT NULL DEFAULT 0,
    output_tokens INT NOT NULL DEFAULT 0,
    estimated_cost NUMERIC(10, 6) NOT NULL DEFAULT 0,
    latency_ms INT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL,
    fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_conversation_id ON ai_usage_logs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at ON ai_usage_logs(created_at);
