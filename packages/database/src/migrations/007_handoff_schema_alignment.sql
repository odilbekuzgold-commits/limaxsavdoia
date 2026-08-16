-- Migration 007: Handoff Schema Alignment & Safe Partial Unique Index

-- 1. Ensure status, notes, and metadata columns exist on handoffs table
ALTER TABLE handoffs
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Add CHECK constraint specifically scoped to public.handoffs table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_handoffs_status'
      AND conrelid = 'public.handoffs'::regclass
  ) THEN
    ALTER TABLE handoffs
      ADD CONSTRAINT chk_handoffs_status
      CHECK (status IN ('PENDING', 'ACCEPTED', 'RESOLVED', 'REJECTED'));
  END IF;
END $$;

-- 3. Non-destructive Preflight: Verify no duplicate PENDING handoffs exist per conversation
DO $$
DECLARE
  dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT conversation_id
    FROM handoffs
    WHERE status = 'PENDING'
    GROUP BY conversation_id
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Migration 007 Aborted: Found % conversations with duplicate PENDING handoffs. Non-destructive rule enforced.', dup_count;
  END IF;
END $$;

-- 4. Create partial unique index: only ONE PENDING handoff per conversation allowed
CREATE UNIQUE INDEX IF NOT EXISTS uq_handoffs_conversation_pending
  ON handoffs(conversation_id)
  WHERE status = 'PENDING';

-- 5. Notification status index on JSONB metadata
CREATE INDEX IF NOT EXISTS idx_handoffs_metadata_mgr_status
  ON handoffs (((metadata->>'managerNotificationStatus')));
