-- Migration 011: Case-insensitive unique index on product codes (ignoring NULL and blank strings)
DO $$
DECLARE
  dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT LOWER(BTRIM(code))
    FROM products
    WHERE code IS NOT NULL AND BTRIM(code) <> ''
    GROUP BY LOWER(BTRIM(code))
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot apply migration 011_products_code_unique: Duplicate product codes exist in products table';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_code_lower
ON products (LOWER(BTRIM(code)))
WHERE code IS NOT NULL AND BTRIM(code) <> '';
