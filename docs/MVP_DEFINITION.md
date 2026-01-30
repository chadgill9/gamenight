# SkinSafe MVP Definition

## Core Loop

**Scan -> Result -> Save -> Repeat**

1. **Scan**: User scans a product barcode (or enters UPC manually)
2. **Result**: App displays fit score (0-100), top flags, and confidence level
3. **Save**: User can save product to local list for future reference
4. **Repeat**: User scans additional products

## In Scope (MVP)

- Welcome screen with disclaimer and consent flow
- User preferences: fragrance-free toggle + avoid-ingredient tags
- Barcode scanning via device camera
- Manual UPC entry fallback
- Product lookup from Supabase database
- Local scoring based on user preferences and ingredient text
- Fit score (0-100) with visual indicator
- Top 3 flags based on user preferences
- Confidence indicator (LOW/MED/HIGH) based on ingredient data quality
- "Product not found" flow with user submission form
- Save products to local storage (AsyncStorage)
- View saved products list
- Anonymous usage (no account required)
- Basic scan event logging to Supabase

## Out of Scope (NOT in MVP)

- User authentication / login / accounts
- User reviews or ratings
- Subscriptions or payments
- Duplicate product finder
- Selfie/skin analysis features
- Social features (sharing, following)
- Brand partnerships or sponsored content
- Push notifications
- Offline mode with full database sync
- Product recommendations
- Ingredient deep-dive / education screens
- Multi-language support
- Accessibility audit (deferred to post-MVP)

## Compliance Language Rules

All copy in the app MUST follow these rules:

- **NEVER** use: "safe", "unsafe", "treat", "cure", "diagnose", "medical advice", "prescription", "dermatologist approved"
- **NEVER** claim the app provides medical or health advice
- **NEVER** suggest a product will treat, cure, or prevent any condition
- **ALWAYS** use: "for informational purposes only"
- **ALWAYS** frame flags as: "may be a concern based on your preferences"
- **ALWAYS** show confidence level when ingredient data is incomplete
- **ALWAYS** include disclaimer that users should consult professionals for medical concerns
- **PREFER** neutral language: "based on your preferences", "may be irritating for some users", "contains ingredients you've chosen to avoid"

## Success Criteria

MVP is complete when:

1. A user can complete the full Scan -> Result -> Save flow
2. Scoring produces consistent, explainable results
3. All compliance language rules are followed
4. App runs on iOS simulator and physical device
5. Supabase integration works for product lookup and scan logging
