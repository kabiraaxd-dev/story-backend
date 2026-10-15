// Assumed read-aloud pace for bedtime-style reading. It's a rough guess, so adjust to taste.
const WORDS_PER_MINUTE = 130;

export function readingMinutes(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
