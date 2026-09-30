// lib/constants.ts

/** The Gemini model identifier used by the API route. */
export const GEMINI_MODEL = "gemini-3.5-flash-lite";

/** Human-readable label shown in the UI footer and badges. */
export const GEMINI_MODEL_LABEL = "gemini-3.5-flash-lite";

/** Max chars for user message input. */
export const MAX_MESSAGE_LENGTH = 2000;

/** Max conversation history entries sent to API. */
export const MAX_HISTORY_ENTRIES = 6;

/** Rate limit: max requests per window. */
export const RATE_LIMIT_MAX_REQUESTS = 35;

/** Rate limit: window duration in ms. */
export const RATE_LIMIT_WINDOW_MS = 60_000;
