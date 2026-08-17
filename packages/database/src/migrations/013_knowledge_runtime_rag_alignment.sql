-- =============================================================================
-- LImax AI Manager — Migration 013: Knowledge Runtime RAG Alignment
-- =============================================================================

-- 1. Ensure valid_from and valid_until columns on knowledge_items
ALTER TABLE knowledge_items
    ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ NULL;

-- 2. Validity constraint: valid_from <= valid_until
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_knowledge_items_validity_dates'
    ) THEN
        ALTER TABLE knowledge_items
            ADD CONSTRAINT chk_knowledge_items_validity_dates
            CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_from <= valid_until);
    END IF;
END $$;

-- 3. Ensure metadata column on knowledge_chunks
ALTER TABLE knowledge_chunks
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- 4. Preflight deduplication check & Unique Index on (knowledge_item_id, chunk_index)
DO $$
DECLARE
    dup_count INT;
BEGIN
    SELECT COUNT(*) INTO dup_count
    FROM (
        SELECT knowledge_item_id, chunk_index
        FROM knowledge_chunks
        GROUP BY knowledge_item_id, chunk_index
        HAVING COUNT(*) > 1
    ) dups;

    IF dup_count > 0 THEN
        RAISE EXCEPTION 'Migration 013 aborted: Found % duplicate (knowledge_item_id, chunk_index) groups in knowledge_chunks. Non-destructive resolution required.', dup_count;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_chunks_item_index
    ON knowledge_chunks (knowledge_item_id, chunk_index);

-- 5. Pgvector Cosine Index on knowledge_chunks embedding
-- Using HNSW index with vector_cosine_ops if supported, otherwise falling back safely
DO $$
BEGIN
    BEGIN
        CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding_cosine
            ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
    EXCEPTION WHEN OTHERS THEN
        -- Fallback to ivfflat or sequential index if hnsw is unavailable on current server
        CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding_cosine
            ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
    END;
END $$;
