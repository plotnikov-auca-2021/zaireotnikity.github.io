import type { DictionaryEntry, SourceLanguage } from '../../types';
import { findImportedDictionaryEntry } from '../../storage/db';
import { firstDictionaryLetter, normalizeWord } from '../../utils/text';

const chunkCache = new Map<string, Record<string, DictionaryEntry>>();

export async function lookupOfflineDictionary(word: string, language: SourceLanguage): Promise<DictionaryEntry | null> {
  const normalized = normalizeWord(word);
  if (!normalized) return null;

  const imported = await findImportedDictionaryEntry(language, `${language}:${normalized}`);
  if (imported) return imported;

  const chunkName = firstDictionaryLetter(normalized);
  const chunk = await loadDictionaryChunk(language, chunkName);
  return chunk[normalized] || findByNormalized(chunk, normalized) || null;
}

async function loadDictionaryChunk(language: SourceLanguage, chunkName: string): Promise<Record<string, DictionaryEntry>> {
  const cacheKey = `${language}:${chunkName}`;
  if (chunkCache.has(cacheKey)) return chunkCache.get(cacheKey)!;

  try {
    const response = await fetch(`${import.meta.env.BASE_URL}dictionaries/${language}-ru/${chunkName}.json`);
    if (!response.ok) throw new Error('Dictionary chunk not found');
    const data = await response.json();
    chunkCache.set(cacheKey, data);
    return data;
  } catch {
    chunkCache.set(cacheKey, {});
    return {};
  }
}

function findByNormalized(chunk: Record<string, DictionaryEntry>, normalized: string): DictionaryEntry | null {
  return Object.values(chunk).find((entry) => entry.normalized === normalized) || null;
}
