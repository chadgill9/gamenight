import { UserPreferences, ScoringResult, ConfidenceLevel } from '../types';

/**
 * Known irritant/allergen keywords for flagging
 * MVP: Simple deterministic keyword matching
 */
const FRAGRANCE_KEYWORDS = [
  'fragrance',
  'parfum',
  'perfume',
  'aroma',
  'essential oil',
  'linalool',
  'limonene',
  'citronellol',
  'geraniol',
  'eugenol',
  'coumarin',
];

const COMMON_IRRITANTS: Record<string, string> = {
  'alcohol denat': 'Alcohol Denat (may be drying)',
  'denatured alcohol': 'Denatured Alcohol (may be drying)',
  'sodium lauryl sulfate': 'SLS (may be irritating)',
  'sodium laureth sulfate': 'SLES (may be irritating)',
  'propylene glycol': 'Propylene Glycol (potential sensitivity)',
  'formaldehyde': 'Formaldehyde (potential sensitivity)',
  'parabens': 'Parabens (potential sensitivity)',
  methylparaben: 'Methylparaben (potential sensitivity)',
  propylparaben: 'Propylparaben (potential sensitivity)',
  'coal tar': 'Coal Tar (potential sensitivity)',
  'hydroquinone': 'Hydroquinone (potential sensitivity)',
};

/**
 * Normalize ingredient text for matching
 */
function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

/**
 * Calculate confidence based on ingredient text quality
 */
function calculateConfidence(ingredientsText: string): ConfidenceLevel {
  const normalized = normalizeText(ingredientsText);

  // Very short or missing text = LOW confidence
  if (!normalized || normalized.length < 20) {
    return 'LOW';
  }

  // Check for signs of incomplete/OCR text
  const hasCommonStructure = normalized.includes(',') || normalized.includes('/');
  const wordCount = normalized.split(/\s+/).length;

  if (!hasCommonStructure || wordCount < 5) {
    return 'LOW';
  }

  if (wordCount < 15 || normalized.length < 100) {
    return 'MED';
  }

  return 'HIGH';
}

/**
 * Check if text contains fragrance-related ingredients
 */
function containsFragrance(ingredientsText: string): boolean {
  const normalized = normalizeText(ingredientsText);
  return FRAGRANCE_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

/**
 * Find matching irritants in ingredient text
 */
function findIrritants(ingredientsText: string): string[] {
  const normalized = normalizeText(ingredientsText);
  const found: string[] = [];

  for (const [keyword, label] of Object.entries(COMMON_IRRITANTS)) {
    if (normalized.includes(keyword.toLowerCase())) {
      found.push(label);
    }
  }

  return found;
}

/**
 * Check if any avoided tags are present
 */
function findAvoidedTags(ingredientsText: string, avoidTags: string[]): string[] {
  const normalized = normalizeText(ingredientsText);
  return avoidTags.filter((tag) => normalized.includes(tag.toLowerCase()));
}

/**
 * Main scoring function
 * Input: user preferences + ingredients_raw_text
 * Output: { fitScore (0-100), flags[], confidence }
 *
 * MVP scoring: Simple deterministic keyword checks
 * - Starts at 100, deducts points for matches
 * - Fragrance check if fragrance_free preference
 * - Avoid tags check
 * - Common irritants flagging
 */
export function calculateScore(
  preferences: UserPreferences,
  ingredientsText: string
): ScoringResult {
  const flags: string[] = [];
  let score = 100;

  // Calculate confidence first
  const confidence = calculateConfidence(ingredientsText);

  // If no/minimal ingredients, return low confidence result
  if (confidence === 'LOW' && (!ingredientsText || ingredientsText.trim().length < 10)) {
    return {
      fitScore: 50, // Neutral score when we can't determine
      flags: ['Incomplete ingredient data - for informational purposes only'],
      confidence: 'LOW',
    };
  }

  // Check fragrance preference
  if (preferences.fragrance_free && containsFragrance(ingredientsText)) {
    flags.push('Contains fragrance (based on your preferences)');
    score -= 30;
  }

  // Check avoided tags
  const matchedAvoidTags = findAvoidedTags(ingredientsText, preferences.avoid_tags);
  for (const tag of matchedAvoidTags) {
    flags.push(`Contains "${tag}" (based on your preferences)`);
    score -= 15;
  }

  // Check common irritants
  const irritants = findIrritants(ingredientsText);
  for (const irritant of irritants.slice(0, 3)) {
    // Limit to top 3
    flags.push(irritant);
    score -= 10;
  }

  // Ensure score stays in bounds
  score = Math.max(0, Math.min(100, score));

  // Limit flags to top 3 most relevant
  const topFlags = flags.slice(0, 3);

  return {
    fitScore: score,
    flags: topFlags,
    confidence,
  };
}

/**
 * Available avoid tags for user selection
 */
export const AVAILABLE_AVOID_TAGS = [
  'alcohol',
  'sulfates',
  'parabens',
  'silicones',
  'retinol',
  'vitamin c',
  'aha',
  'bha',
  'salicylic acid',
  'benzoyl peroxide',
  'niacinamide',
  'hyaluronic acid',
];
