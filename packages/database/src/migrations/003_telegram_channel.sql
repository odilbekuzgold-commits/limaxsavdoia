-- Migration 003: Telegram Business Connections and Update Receipts

-- Telegram Business Connections
CREATE TABLE IF NOT EXISTS telegram_business_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id VARCHAR(255) NOT NULL UNIQUE,
    business_user_id VARCHAR(255) NOT NULL,
    user_chat_id VARCHAR(255) NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    rights JSONB DEFAULT '{}'::jsonb,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Telegram Update Receipts (Deduplication & Idempotency)
CREATE TABLE IF NOT EXISTS telegram_update_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    update_id BIGINT NOT NULL UNIQUE,
    update_type VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PROCESSED',
    error_code VARCHAR(100),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_telegram_business_connections_user_id ON telegram_business_connections(business_user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_update_receipts_update_id ON telegram_update_receipts(update_id);
