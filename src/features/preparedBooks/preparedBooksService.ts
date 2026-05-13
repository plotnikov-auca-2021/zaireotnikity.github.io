import type {
  AiExplanationRecord,
  BookRecord,
  DictionaryEntryRecord,
  DictionarySourceRecord,
  PageTextRecord,
  SourceLanguage
} from '../../types';
import { getByKey, importDictionarySource, put } from '../../storage/db';
import { generateId, normalizeWord, splitIntoSentences } from '../../utils/text';

export interface PreparedBookCatalogItem {
  id: string;
  title: string;
  author?: string;
  sourceLanguage: SourceLanguage;
  level?: string;
  description?: string;
  folder: string;
  pageCount?: number;
  bookFile?: string;
  translationsFile?: string | null;
  dictionaryFile?: string | null;
}

export interface PreparedBookCatalog {
  books: PreparedBookCatalogItem[];
}

type PreparedSentence = {
  id: string;
  text: string;
};

type PreparedPage = {
  pageNumber: number;
  text: string;
  sentences: PreparedSentence[];
};

interface PreparedBookJson {
  id?: string;
  title?: string;
  author?: string;
  sourceLanguage?: SourceLanguage;
  pages?: Array<{
    pageNumber?: number;
    text?: string;
    sentences?: Array<string | { id?: string; text?: string }>;
  }>;
}

export interface PreparedBookImportResult {
  bookId: string;
  title: string;
  pageCount: number;
  translations: number;
  dictionaryEntries: number;
  alreadyExisted: boolean;
}

export async function fetchPreparedCatalog(): Promise<PreparedBookCatalogItem[]> {
  const url = makeAssetUrl(`books/catalog.json?v=${Date.now()}`);
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return [];
    const data = await response.json();
    const rawItems = Array.isArray(data) ? data : Array.isArray(data?.books) ? data.books : [];
    return rawItems
      .map(normalizeCatalogItem)
      .filter((item: PreparedBookCatalogItem | null): item is PreparedBookCatalogItem => Boolean(item));
  } catch {
    return [];
  }
}

export async function importPreparedBook(item: PreparedBookCatalogItem): Promise<PreparedBookImportResult> {
  const existing = await getByKey('books', item.id);
  const folder = normalizeFolder(item.folder);
  const bookJson = await fetchJson<PreparedBookJson>(`${folder}/${item.bookFile || 'book.json'}`);
  const normalizedPages = normalizePreparedPages(bookJson, item);
  if (!normalizedPages.length) {
    throw new Error('Prepared book has no readable pages.');
  }

  const now = new Date().toISOString();
  const bookId = bookJson.id || item.id;
  const title = bookJson.title || item.title;
  const sourceLanguage = normalizeSourceLanguage(bookJson.sourceLanguage || item.sourceLanguage);
  const bookRecord: BookRecord = {
    id: bookId,
    title,
    sourceLanguage,
    fileName: `${bookId}.prepared.json`,
    fileBlob: new Blob([JSON.stringify(bookJson)], { type: 'application/json' }),
    pageCount: normalizedPages.length,
    createdAt: existing?.createdAt || now,
    lastOpenedAt: now
  };

  await put('books', bookRecord);
  await Promise.all(
    normalizedPages.map((page) =>
      put('pages', {
        id: `${bookId}-page-${page.pageNumber}`,
        bookId,
        pageNumber: page.pageNumber,
        text: page.text
      })
    )
  );
  await put('progress', { bookId, currentPage: 1, updatedAt: now });

  const translationJson = item.translationsFile === null
    ? null
    : await fetchOptionalJson(`${folder}/${item.translationsFile || 'translations.ru.json'}`);
  const translations = buildTranslationMap(translationJson);
  let savedTranslations = 0;
  for (const page of normalizedPages) {
    for (const sentence of page.sentences) {
      const translation = translations.get(sentence.id) || translations.get(sentence.text);
      if (!translation) continue;
      const cacheRecord: AiExplanationRecord = {
        id: `prepared_translation_${bookId}_${safeId(sentence.id || sentence.text)}`,
        bookId,
        sourceLanguage,
        mode: 'translation',
        inputText: sentence.text,
        responseRu: translation,
        createdAt: now
      };
      await put('aiCache', cacheRecord);
      savedTranslations += 1;
    }
  }

  const dictionaryJson = item.dictionaryFile === null
    ? null
    : await fetchOptionalJson(`${folder}/${item.dictionaryFile || 'dictionary.json'}`);
  const dictionaryEntries = buildDictionaryEntries(dictionaryJson, bookId, title, sourceLanguage, now);
  if (dictionaryEntries.entries.length) {
    await importDictionarySource(dictionaryEntries.source, dictionaryEntries.entries);
  }

  return {
    bookId,
    title,
    pageCount: normalizedPages.length,
    translations: savedTranslations,
    dictionaryEntries: dictionaryEntries.entries.length,
    alreadyExisted: Boolean(existing)
  };
}

function normalizeCatalogItem(raw: any): PreparedBookCatalogItem | null {
  if (!raw || !raw.id || !raw.title || !raw.folder) return null;
  return {
    id: String(raw.id),
    title: String(raw.title),
    author: raw.author ? String(raw.author) : undefined,
    sourceLanguage: normalizeSourceLanguage(raw.sourceLanguage),
    level: raw.level ? String(raw.level) : undefined,
    description: raw.description ? String(raw.description) : undefined,
    folder: String(raw.folder),
    pageCount: Number.isFinite(Number(raw.pageCount)) ? Number(raw.pageCount) : undefined,
    bookFile: raw.bookFile === null ? undefined : raw.bookFile ? String(raw.bookFile) : undefined,
    translationsFile: raw.translationsFile === null ? null : raw.translationsFile ? String(raw.translationsFile) : undefined,
    dictionaryFile: raw.dictionaryFile === null ? null : raw.dictionaryFile ? String(raw.dictionaryFile) : undefined
  };
}

function normalizeSourceLanguage(language: unknown): SourceLanguage {
  return language === 'en' ? 'en' : 'fr';
}

function normalizeFolder(folder: string): string {
  return folder.replace(/^\/+/, '').replace(/\/+$/, '');
}

function makeAssetUrl(path: string): string {
  return new URL(path.replace(/^\/+/, ''), document.baseURI).toString();
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(makeAssetUrl(path), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.json() as Promise<T>;
}

async function fetchOptionalJson(path: string): Promise<any | null> {
  try {
    const response = await fetch(makeAssetUrl(path), { cache: 'no-store' });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function normalizePreparedPages(bookJson: PreparedBookJson, item: PreparedBookCatalogItem): PreparedPage[] {
  const rawPages = Array.isArray(bookJson.pages) ? bookJson.pages : [];
  return rawPages.map((rawPage, pageIndex) => {
    const pageNumber = Number(rawPage.pageNumber) || pageIndex + 1;
    const rawSentences = Array.isArray(rawPage.sentences) ? rawPage.sentences : [];
    const sentences: PreparedSentence[] = rawSentences
      .map((sentence, sentenceIndex) => {
        if (typeof sentence === 'string') {
          return { id: `p${pageNumber}-s${sentenceIndex + 1}`, text: sentence.trim() };
        }
        const text = String(sentence?.text || '').trim();
        return { id: sentence?.id ? String(sentence.id) : `p${pageNumber}-s${sentenceIndex + 1}`, text };
      })
      .filter((sentence) => sentence.text);

    if (!sentences.length && rawPage.text) {
      splitIntoSentences(String(rawPage.text)).forEach((sentence, sentenceIndex) => {
        sentences.push({ id: `p${pageNumber}-s${sentenceIndex + 1}`, text: sentence });
      });
    }

    const text = String(rawPage.text || sentences.map((sentence) => sentence.text).join(' ')).trim();
    return { pageNumber, text, sentences };
  }).filter((page) => page.text);
}

function buildTranslationMap(raw: any): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;

  const source = raw.translations || raw;
  if (Array.isArray(source)) {
    for (const item of source) {
      const translation = readTranslation(item);
      if (!translation) continue;
      const id = item.id || item.sentenceId;
      const text = item.text || item.source || item.sentence;
      if (id) map.set(String(id), translation);
      if (text) map.set(String(text).trim(), translation);
    }
    return map;
  }

  if (typeof source === 'object') {
    for (const [key, value] of Object.entries(source)) {
      const translation = typeof value === 'string' ? value : readTranslation(value);
      if (translation) map.set(key.trim(), translation);
    }
  }
  return map;
}

function readTranslation(value: any): string {
  if (typeof value === 'string') return value.trim();
  if (!value) return '';
  return String(value.translationRu || value.translation || value.ru || '').trim();
}

function buildDictionaryEntries(raw: any, bookId: string, title: string, language: SourceLanguage, now: string): { source: DictionarySourceRecord; entries: DictionaryEntryRecord[] } {
  const sourceId = `prepared-dictionary-${language}-${bookId}`;
  const sourceName = `Prepared dictionary · ${title}`;
  const source: DictionarySourceRecord = {
    id: sourceId,
    name: sourceName,
    language,
    format: 'json',
    entryCount: 0,
    createdAt: now
  };

  const rawEntries = Array.isArray(raw) ? raw : Array.isArray(raw?.entries) ? raw.entries : [];
  const seen = new Set<string>();
  const entries: DictionaryEntryRecord[] = [];

  for (const item of rawEntries) {
    const word = String(item?.word || '').trim();
    const normalized = normalizeWord(word);
    if (!word || !normalized || seen.has(normalized)) continue;
    const translationsRu = Array.isArray(item.translationsRu)
      ? item.translationsRu.map((value: unknown) => String(value).trim()).filter(Boolean)
      : item.translationRu
        ? [String(item.translationRu).trim()]
        : [];
    if (!translationsRu.length) continue;
    seen.add(normalized);
    entries.push({
      id: `dict_prepared_${bookId}_${language}_${safeId(normalized)}`,
      lookupKey: `${language}:${normalized}`,
      sourceId,
      sourceName,
      source: word,
      normalized,
      language,
      translationsRu,
      lemma: item.lemma ? String(item.lemma) : undefined,
      grammarRu: item.grammar ? String(item.grammar) : undefined,
      partOfSpeech: item.partOfSpeech ? String(item.partOfSpeech) : undefined,
      generatedByAi: Boolean(item.generatedByAi),
      importedAt: now
    });
  }

  source.entryCount = entries.length;
  return { source, entries };
}

function safeId(value: string): string {
  const normalized = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9а-яё]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return normalized || generateId('prepared');
}
