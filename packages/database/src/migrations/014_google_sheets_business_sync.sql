-- Migration 014: Google Sheets Business Data Sync Schema Alignment
-- Adds payment_type to product_prices, source metadata to products/prices/inventory,
-- replaces single active price index with per-payment-type index, and creates google_sheets_sync_state table.

-- 1. Add source metadata to products
ALTER TABLE products
ADD COLUMN IF NOT EXISTS source_system VARCHAR(64) DEFAULT 'GOOGLE_SHEETS',
ADD COLUMN IF NOT EXISTS external_row_id VARCHAR(128),
ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

-- 2. Add payment_type and source metadata to product_prices
ALTER TABLE product_prices
ADD COLUMN IF NOT EXISTS payment_type VARCHAR(32) NOT NULL DEFAULT 'LEGACY',
ADD COLUMN IF NOT EXISTS source_system VARCHAR(64) DEFAULT 'GOOGLE_SHEETS',
ADD COLUMN IF NOT EXISTS external_row_id VARCHAR(128),
ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

-- 3. Replace single ACTIVE price index with (product_id, payment_type) ACTIVE price index
DROP INDEX IF EXISTS uq_product_prices_single_active;

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_prices_active_per_payment_type
ON product_prices(product_id, payment_type)
WHERE active = true;

-- 4. Add source metadata to product_inventory
ALTER TABLE product_inventory
ADD COLUMN IF NOT EXISTS source_system VARCHAR(64) DEFAULT 'GOOGLE_SHEETS',
ADD COLUMN IF NOT EXISTS external_row_id VARCHAR(128),
ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

-- 5. Create google_sheets_sync_state table
CREATE TABLE IF NOT EXISTS google_sheets_sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spreadsheet_id VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_success_at TIMESTAMPTZ,
  checksum VARCHAR(128),
  products_count INT NOT NULL DEFAULT 0,
  prices_count INT NOT NULL DEFAULT 0,
  inventory_count INT NOT NULL DEFAULT 0,
  sanitized_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_google_sheets_sync_state_last_success
ON google_sheets_sync_state(last_success_at DESC NULLS LAST);
