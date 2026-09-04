-- Stage 17.3: Make minimum_quantity in product_prices nullable
-- Ensures Google Sheets prices without explicit MOQ do not have fabricated values (e.g. 1 kg)

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'product_prices' 
          AND column_name = 'minimum_quantity' 
          AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE product_prices ALTER COLUMN minimum_quantity DROP NOT NULL;
    END IF;
END $$;
