/**
 * featureFlags.ts — single source of truth for toggling features.
 * Import FEATURES anywhere; change a flag here to propagate everywhere.
 */

export const FEATURES = {
  /**
   * Custom frog creator — gated by 50 000 $FROGNAL on Base mainnet.
   * Requires:
   *   NEXT_PUBLIC_SUPABASE_URL
   *   NEXT_PUBLIC_SUPABASE_ANON_KEY   (client-side read)
   *   SUPABASE_SERVICE_ROLE_KEY       (server-side write)
   *   ENCRYPTION_KEY                  (32-char hex, for API key encryption)
   *   NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
   */
  CUSTOM_FROG_CREATOR: true,

  /**
   * AI-generated frog portraits — gemini-2.5-flash-image, ~$0.039/image.
   * NOT on the Gemini free tier. Enable only when you have budget.
   */
  IMAGE_GENERATION: false,
} as const;
