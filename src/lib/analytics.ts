/**
 * Analytics stub for SkinSafe
 * TODO: Replace with actual analytics SDK (e.g., Mixpanel, Amplitude, Segment)
 */

// TODO: Add analytics API keys
// const ANALYTICS_API_KEY = process.env.EXPO_PUBLIC_ANALYTICS_KEY || '';

type EventProperties = Record<string, string | number | boolean | undefined>;

/**
 * Track an analytics event
 * @param eventName - Name of the event
 * @param properties - Optional event properties
 */
export function track(eventName: string, properties?: EventProperties): void {
  // TODO: Replace with actual analytics implementation
  if (__DEV__) {
    console.log(`[Analytics] Track: ${eventName}`, properties || {});
  }

  // Example implementation with a real SDK:
  // analytics.track(eventName, properties);
}

/**
 * Identify a user for analytics
 * @param userId - Unique user identifier
 * @param traits - Optional user traits
 */
export function identify(userId: string, traits?: EventProperties): void {
  // TODO: Replace with actual analytics implementation
  if (__DEV__) {
    console.log(`[Analytics] Identify: ${userId}`, traits || {});
  }

  // Example implementation with a real SDK:
  // analytics.identify(userId, traits);
}

// Pre-defined event names for consistency
export const AnalyticsEvents = {
  ONBOARDING_COMPLETED: 'onboarding_completed',
  SCAN_STARTED: 'scan_started',
  SCAN_SUCCESS: 'scan_success',
  SCAN_NOT_FOUND: 'scan_not_found',
  PRODUCT_SUBMITTED: 'product_submitted',
  RESULT_VIEWED: 'result_viewed',
  SAVE_PRODUCT: 'save_product',
} as const;

// Convenience functions for common events
export const Analytics = {
  onboardingCompleted: () => track(AnalyticsEvents.ONBOARDING_COMPLETED),

  scanStarted: () => track(AnalyticsEvents.SCAN_STARTED),

  scanSuccess: (upc: string, productName?: string) =>
    track(AnalyticsEvents.SCAN_SUCCESS, { upc, product_name: productName }),

  scanNotFound: (upc: string) => track(AnalyticsEvents.SCAN_NOT_FOUND, { upc }),

  productSubmitted: (upc: string, productName: string) =>
    track(AnalyticsEvents.PRODUCT_SUBMITTED, { upc, product_name: productName }),

  resultViewed: (upc: string, fitScore: number, confidence: string) =>
    track(AnalyticsEvents.RESULT_VIEWED, { upc, fit_score: fitScore, confidence }),

  saveProduct: (upc: string, productName: string, fitScore: number) =>
    track(AnalyticsEvents.SAVE_PRODUCT, { upc, product_name: productName, fit_score: fitScore }),
};
