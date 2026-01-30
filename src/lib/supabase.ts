import { createClient } from '@supabase/supabase-js';
import { Product, ScanEvent } from '../types';

// Environment variables for Supabase
// In Expo, use EXPO_PUBLIC_ prefix for client-side env vars
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase credentials not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Fetch a product by UPC code
 */
export async function getProductByUPC(upc: string): Promise<Product | null> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('upc', upc)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned
      return null;
    }
    console.error('Error fetching product:', error);
    return null;
  }

  return data as Product;
}

/**
 * Add a new product (user-submitted)
 */
export async function addProduct(
  upc: string,
  name: string,
  brand: string,
  ingredients_raw_text: string
): Promise<Product | null> {
  const { data, error } = await supabase
    .from('products')
    .insert({
      upc,
      name,
      brand,
      ingredients_raw_text,
    })
    .select()
    .single();

  if (error) {
    console.error('Error adding product:', error);
    return null;
  }

  return data as Product;
}

/**
 * Log a scan event to Supabase
 */
export async function logScanEvent(event: Omit<ScanEvent, 'id' | 'created_at'>): Promise<void> {
  const { error } = await supabase.from('scans').insert(event);

  if (error) {
    console.error('Error logging scan event:', error);
  }
}
