-- Migration 016: Managers Core Entities & Initial Sales Team
CREATE TABLE IF NOT EXISTS managers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    role VARCHAR(100) NOT NULL DEFAULT 'Sotuv menejeri',
    phone VARCHAR(50),
    telegram_username VARCHAR(100),
    telegram_chat_id VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    is_on_duty BOOLEAN NOT NULL DEFAULT FALSE,
    specialties TEXT[] DEFAULT '{}',
    max_active_leads INT NOT NULL DEFAULT 20,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Initial seed sales managers for Limax Yarn
INSERT INTO managers (name, role, phone, telegram_username, status, is_on_duty, specialties, max_active_leads)
SELECT 'Azizbek Karimov', 'Bosh sotuv menejeri', '+998 90 912 34 56', 'aziz_limax', 'ACTIVE', TRUE, ARRAY['Ip 30/70', 'Eksport', 'Katta buyurtmalar'], 30
WHERE NOT EXISTS (SELECT 1 FROM managers WHERE name = 'Azizbek Karimov');

INSERT INTO managers (name, role, phone, telegram_username, status, is_on_duty, specialties, max_active_leads)
SELECT 'Dilshod Saidov', 'Eksport va VIP buyurtmalar menejeri', '+998 97 765 43 21', 'dilshod_limax', 'ACTIVE', FALSE, ARRAY['Eksport', 'Bo''yalgan ip', 'To''qimachilik korxonalari'], 25
WHERE NOT EXISTS (SELECT 1 FROM managers WHERE name = 'Dilshod Saidov');

INSERT INTO managers (name, role, phone, telegram_username, status, is_on_duty, specialties, max_active_leads)
SELECT 'Jamshid Qodirov', 'Ichki bozor va chakana savdo menejeri', '+998 93 555 88 99', 'jamshid_limax', 'ACTIVE', FALSE, ARRAY['Ichki bozor', 'Quti va namunalar', 'Yangi xaridorlar'], 20
WHERE NOT EXISTS (SELECT 1 FROM managers WHERE name = 'Jamshid Qodirov');
