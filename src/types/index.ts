// Product types
export interface Product {
  id: string;
  upc: string;
  name: string;
  brand: string;
  ingredients_raw_text: string;
  created_at: string;
  updated_at: string;
}

// User preferences
export interface UserPreferences {
  fragrance_free: boolean;
  avoid_tags: string[];
}

// Scoring types
export type ConfidenceLevel = 'LOW' | 'MED' | 'HIGH';

export interface ScoringResult {
  fitScore: number; // 0-100
  flags: string[];
  confidence: ConfidenceLevel;
}

// Saved product for local storage
export interface SavedProduct {
  upc: string;
  name: string;
  brand: string;
  fitScore: number;
  flags: string[];
  confidence: ConfidenceLevel;
  savedAt: string;
}

// Navigation param list
export type RootStackParamList = {
  Welcome: undefined;
  Preferences: undefined;
  Scan: undefined;
  Result: {
    upc: string;
    product?: Product;
    notFound?: boolean;
  };
  Saved: undefined;
};

// Scan event for analytics logging
export interface ScanEvent {
  id?: string;
  upc: string;
  found: boolean;
  fit_score?: number;
  created_at?: string;
}
