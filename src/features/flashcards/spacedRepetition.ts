import type { VocabularyRecord } from '../../types';

export type ReviewQuality = 'again' | 'hard' | 'good' | 'easy';

export function scheduleReview(word: VocabularyRecord, quality: ReviewQuality): VocabularyRecord {
  const next = { ...word };
  const today = new Date();

  if (quality === 'again') {
    next.intervalDays = 1;
    next.ease = Math.max(1.3, word.ease - 0.2);
    next.status = 'learning';
  } else if (quality === 'hard') {
    next.intervalDays = Math.max(1, Math.round(word.intervalDays * 1.2));
    next.ease = Math.max(1.3, word.ease - 0.1);
    next.status = 'learning';
  } else if (quality === 'good') {
    next.intervalDays = Math.max(2, Math.round(word.intervalDays * word.ease));
    next.status = 'learning';
  } else {
    next.intervalDays = Math.max(4, Math.round(word.intervalDays * (word.ease + 0.4)));
    next.ease = word.ease + 0.15;
    next.status = 'known';
  }

  const due = new Date(today.getTime() + next.intervalDays * 24 * 60 * 60 * 1000);
  next.nextReviewAt = due.toISOString();
  return next;
}
