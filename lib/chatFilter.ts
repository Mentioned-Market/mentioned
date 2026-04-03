import { profanity, CensorType } from '@2toad/profanity'

/**
 * Check if a message contains blocked slurs or hate speech.
 * Returns a matched string if blocked, or null if clean.
 */
export function checkSlurs(message: string): string | null {
  if (profanity.exists(message)) {
    const censored = profanity.censor(message, CensorType.Word)
    return censored !== message ? 'profanity' : null
  }
  return null
}
