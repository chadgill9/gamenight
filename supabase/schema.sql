-- SkinSafe Database Schema
-- Run this SQL in Supabase SQL Editor to create the required tables

-- Products table: stores product information and ingredients
CREATE TABLE IF NOT EXISTS products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  upc VARCHAR(14) NOT NULL,
  name VARCHAR(255) NOT NULL,
  brand VARCHAR(255) NOT NULL,
  ingredients_raw_text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on UPC for fast lookups
CREATE INDEX IF NOT EXISTS idx_products_upc ON products(upc);

-- Scans table: logs scan events for analytics
CREATE TABLE IF NOT EXISTS scans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  upc VARCHAR(14) NOT NULL,
  found BOOLEAN NOT NULL DEFAULT FALSE,
  fit_score INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on created_at for time-based queries
CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scans(created_at);

-- Enable Row Level Security (RLS)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE scans ENABLE ROW LEVEL SECURITY;

-- Create policies for anonymous access (using anon key)
-- Products: Anyone can read, anyone can insert
CREATE POLICY "Allow anonymous read on products"
  ON products FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow anonymous insert on products"
  ON products FOR INSERT
  TO anon
  WITH CHECK (true);

-- Scans: Anyone can insert (logging), no read access for anon
CREATE POLICY "Allow anonymous insert on scans"
  ON scans FOR INSERT
  TO anon
  WITH CHECK (true);

-- Optional: Add some sample products for testing
INSERT INTO products (upc, name, brand, ingredients_raw_text) VALUES
  ('012345678901', 'Gentle Cleanser', 'TestBrand', 'Water, Glycerin, Sodium Cocoyl Isethionate, Niacinamide, Ceramide NP, Hyaluronic Acid'),
  ('012345678902', 'Hydrating Moisturizer', 'TestBrand', 'Aqua, Glycerin, Dimethicone, Parfum, Cetyl Alcohol, Phenoxyethanol'),
  ('012345678903', 'Exfoliating Toner', 'TestBrand', 'Water, Alcohol Denat, Salicylic Acid, Niacinamide, Sodium Lauryl Sulfate, Fragrance, Essential Oil of Lavender')
ON CONFLICT DO NOTHING;
