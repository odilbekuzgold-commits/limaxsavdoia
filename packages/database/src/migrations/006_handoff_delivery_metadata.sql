-- Migration 006: Handoff Delivery Metadata & Idempotency Tracking

-- Add metadata column to handoffs table for JSONB tracking of delivery status
ALTER TABLE handoffs
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Index for fast lookup and filtering of manager notification status
CREATE INDEX IF NOT EXISTS idx_handoffs_metadata_mgr_status
  ON handoffs (((metadata->>'managerNotificationStatus')));
