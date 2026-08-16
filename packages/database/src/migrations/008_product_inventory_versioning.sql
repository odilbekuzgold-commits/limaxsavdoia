-- Migration 008: Add optimistic locking version column to product_inventory
ALTER TABLE product_inventory ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
