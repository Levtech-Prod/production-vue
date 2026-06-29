CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(60),
  password_hash TEXT NOT NULL,
  admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS part_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL UNIQUE,
  description TEXT,
  image TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS part_category_parameters (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES part_categories(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  type VARCHAR(30) NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'number', 'boolean')),
  unit VARCHAR(40),
  required BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(category_id, name)
);

CREATE TABLE IF NOT EXISTS parts (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES part_categories(id),
  name VARCHAR(180) NOT NULL,
  code VARCHAR(120) NOT NULL UNIQUE,
  price_per_piece NUMERIC(12, 2) NOT NULL DEFAULT 0,
  location VARCHAR(180),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_parameters (
  id SERIAL PRIMARY KEY,
  part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  parameter_id INTEGER NOT NULL REFERENCES part_category_parameters(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(part_id, parameter_id)
);

CREATE INDEX IF NOT EXISTS idx_part_category_parameters_category_id ON part_category_parameters(category_id);
CREATE INDEX IF NOT EXISTS idx_parts_category_id ON parts(category_id);
CREATE INDEX IF NOT EXISTS idx_stock_parameters_part_id ON stock_parameters(part_id);

-- Idempotent migrations (safe to re-run on existing databases) ---------------

-- Dropdown options for category parameters
ALTER TABLE part_category_parameters
  ADD COLUMN IF NOT EXISTS options TEXT[] NOT NULL DEFAULT ARRAY[]::text[];

-- Allow 'dropdown' as a parameter type
ALTER TABLE part_category_parameters
  DROP CONSTRAINT IF EXISTS part_category_parameters_type_check;
ALTER TABLE part_category_parameters
  ADD CONSTRAINT part_category_parameters_type_check
  CHECK (type IN ('text', 'number', 'boolean', 'dropdown'));

-- Part code (required + unique). Added nullable, backfilled, then constrained
-- so the migration also works on databases that already contain parts.
ALTER TABLE parts ADD COLUMN IF NOT EXISTS code VARCHAR(120);
UPDATE parts SET code = 'PART-' || id WHERE code IS NULL;
ALTER TABLE parts ALTER COLUMN code SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'parts_code_key'
  ) THEN
    ALTER TABLE parts ADD CONSTRAINT parts_code_key UNIQUE (code);
  END IF;
END $$;
