-- Migration 010: Add product code column to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS code VARCHAR(100);
