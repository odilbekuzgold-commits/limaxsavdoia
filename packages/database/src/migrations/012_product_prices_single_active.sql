-- Migration 012: Enforce single ACTIVE price invariant per product in product_prices table
DO $$
DECLARE
  dup_active_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_active_count
  FROM (
    SELECT product_id
    FROM product_prices
    WHERE active = true
    GROUP BY product_id
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_active_count > 0 THEN
    RAISE EXCEPTION 'Cannot apply migration 012_product_prices_single_active: Multiple active prices exist for a product';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_prices_single_active
ON product_prices(product_id)
WHERE active = true;
