/**
 * promptTypes.ts
 *
 * Structured prompt types for the Gemini API.
 * Replaces the old Gemma-formatted raw-string approach.
 */

/** A one-shot generation request (interruptions, silence, poke, debate, agreement). */
export interface OneShotPrompt {
  systemPrompt: string;
  userContext: string;
}

/** A multimodal one-shot request (frog image reactions). */
export interface ImagePrompt {
  systemPrompt: string;
  userContext: string;
  imageDataUrl: string;
}