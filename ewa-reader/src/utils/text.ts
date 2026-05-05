export function generateId(prefix = 'id'): string {
  const cryptoPart = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `${prefix}_${cryptoPart}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeWord(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
}

export function displayCleanWord(input: string): string {
  return input.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').trim();
}

export function firstDictionaryLetter(normalizedWord: string): string {
  const first = normalizedWord[0] || '#';
  return /^[a-z]$/.test(first) ? first : '#';
}

export function splitIntoSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function splitSentenceIntoParts(sentence: string): Array<{ type: 'word' | 'space' | 'punctuation'; value: string }> {
  const parts: Array<{ type: 'word' | 'space' | 'punctuation'; value: string }> = [];
  const re = /(\p{L}+[\p{L}'’\-]*)|(\s+)|([^\p{L}\s]+)/gu;
  for (const match of sentence.matchAll(re)) {
    const value = match[0];
    if (/^\s+$/u.test(value)) parts.push({ type: 'space', value });
    else if (/^\p{L}/u.test(value)) parts.push({ type: 'word', value });
    else parts.push({ type: 'punctuation', value });
  }
  return parts;
}

export function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
