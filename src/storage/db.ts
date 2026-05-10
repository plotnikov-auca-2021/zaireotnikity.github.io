import type {
  AiExplanationRecord,
  AiProvider,
  AppSettings,
  BookRecord,
  DictionaryEntryRecord,
  DictionarySourceRecord,
  PageTextRecord,
  ReadingProgressRecord,
  SourceLanguage,
  VocabularyRecord
} from '../types';

const DB_NAME = 'ewa-reader-db';
const DB_VERSION = 3;

export const AI_PROVIDERS: AiProvider[] = ['openai', 'gemini', 'groq', 'openrouter', 'mistral'];

export const DEFAULT_AI_MODELS: Record<AiProvider, string> = {
  openai: 'gpt-4.1-mini',
  gemini: 'gemini-2.5-flash',
  groq: 'llama-3.3-70b-versatile',
  openrouter: 'openrouter/auto',
  mistral: 'mistral-small-latest'
};

export const DEFAULT_SETTINGS: AppSettings = {
  uiLanguage: 'ru',
  aiProvider: 'openai',
  aiApiKeys: { openai: '', gemini: '', groq: '', openrouter: '', mistral: '' },
  aiModels: DEFAULT_AI_MODELS,
  defaultSourceLanguage: 'fr',
  hasRequestedPersistentStorage: false,
  quizQuestionLanguage: 'ru'
};

export function getGlobalAiDictionarySourceId(language: SourceLanguage): string {
  return `ai-dictionary-global-${language}`;
}

export function getGlobalAiDictionarySourceName(language: SourceLanguage): string {
  return language === 'fr' ? 'AI learned dictionary · French → Russian' : 'AI learned dictionary · English → Russian';
}

type StoreName = 'books' | 'pages' | 'progress' | 'vocabulary' | 'aiCache' | 'settings' | 'dictionarySources' | 'dictionaryEntries';

type StoreValueMap = {
  books: BookRecord;
  pages: PageTextRecord;
  progress: ReadingProgressRecord;
  vocabulary: VocabularyRecord;
  aiCache: AiExplanationRecord;
  settings: { id: string; value: AppSettings | string };
  dictionarySources: DictionarySourceRecord;
  dictionaryEntries: DictionaryEntryRecord;
};

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains('books')) {
        db.createObjectStore('books', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('pages')) {
        const store = db.createObjectStore('pages', { keyPath: 'id' });
        store.createIndex('bookId', 'bookId', { unique: false });
      }
      if (!db.objectStoreNames.contains('progress')) {
        db.createObjectStore('progress', { keyPath: 'bookId' });
      }
      if (!db.objectStoreNames.contains('vocabulary')) {
        const store = db.createObjectStore('vocabulary', { keyPath: 'id' });
        store.createIndex('bookId', 'bookId', { unique: false });
        store.createIndex('nextReviewAt', 'nextReviewAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('aiCache')) {
        const store = db.createObjectStore('aiCache', { keyPath: 'id' });
        store.createIndex('bookId', 'bookId', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('dictionarySources')) {
        const store = db.createObjectStore('dictionarySources', { keyPath: 'id' });
        store.createIndex('language', 'language', { unique: false });
      }
      if (!db.objectStoreNames.contains('dictionaryEntries')) {
        const store = db.createObjectStore('dictionaryEntries', { keyPath: 'id' });
        store.createIndex('lookupKey', 'lookupKey', { unique: false });
        store.createIndex('sourceId', 'sourceId', { unique: false });
        store.createIndex('language', 'language', { unique: false });
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

  return dbPromise;
}

async function transaction<T>(storeName: StoreName, mode: IDBTransactionMode, callback: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = callback(store);

    if (request) {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    }

    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => {
      if (!request) resolve();
    };
  });
}

export async function getByKey<K extends StoreName>(store: K, key: IDBValidKey): Promise<StoreValueMap[K] | undefined> {
  return transaction<StoreValueMap[K]>(store, 'readonly', (objectStore) => objectStore.get(key)) as Promise<StoreValueMap[K] | undefined>;
}

export async function getAll<K extends StoreName>(store: K): Promise<StoreValueMap[K][]> {
  return transaction<StoreValueMap[K][]>(store, 'readonly', (objectStore) => objectStore.getAll()) as Promise<StoreValueMap[K][]>;
}

export async function put<K extends StoreName>(store: K, value: StoreValueMap[K]): Promise<void> {
  await transaction(store, 'readwrite', (objectStore) => objectStore.put(value));
}

export async function deleteByKey(store: StoreName, key: IDBValidKey): Promise<void> {
  await transaction(store, 'readwrite', (objectStore) => objectStore.delete(key));
}

export async function clearStore(store: StoreName): Promise<void> {
  await transaction(store, 'readwrite', (objectStore) => objectStore.clear());
}

export async function getSettings(): Promise<AppSettings> {
  const record = await getByKey('settings', 'app');
  if (!record || typeof record.value === 'string') return DEFAULT_SETTINGS;
  return normalizeSettings(record.value as Partial<AppSettings>);
}

export function normalizeSettings(raw: Partial<AppSettings>): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  const aiApiKeys = { ...DEFAULT_SETTINGS.aiApiKeys, ...(raw.aiApiKeys || {}) };
  const aiModels = { ...DEFAULT_SETTINGS.aiModels, ...(raw.aiModels || {}) };

  if (raw.openAiApiKey && !aiApiKeys.openai) aiApiKeys.openai = raw.openAiApiKey;
  if (raw.openAiModel && (!raw.aiModels || !raw.aiModels.openai)) aiModels.openai = raw.openAiModel;

  const aiProvider = AI_PROVIDERS.includes(merged.aiProvider) ? merged.aiProvider : DEFAULT_SETTINGS.aiProvider;
  const quizQuestionLanguage = merged.quizQuestionLanguage === 'source' ? 'source' : 'ru';

  return { ...merged, aiProvider, aiApiKeys, aiModels, quizQuestionLanguage, openAiApiKey: undefined, openAiModel: undefined };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await put('settings', { id: 'app', value: normalizeSettings(settings) });
}

export async function getPagesByBook(bookId: string): Promise<PageTextRecord[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pages', 'readonly');
    const index = tx.objectStore('pages').index('bookId');
    const request = index.getAll(bookId);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.pageNumber - b.pageNumber));
  });
}

export async function getVocabularyByBook(bookId?: string): Promise<VocabularyRecord[]> {
  const all = await getAll('vocabulary');
  return (bookId ? all.filter((item) => item.bookId === bookId) : all).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function findImportedDictionaryEntry(language: SourceLanguage, lookupKey: string): Promise<DictionaryEntryRecord | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('dictionaryEntries', 'readonly');
    const index = tx.objectStore('dictionaryEntries').index('lookupKey');
    const request = index.getAll(lookupKey);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const match = request.result.find((entry) => entry.language === language);
      resolve(match || null);
    };
  });
}

export async function importDictionarySource(source: DictionarySourceRecord, entries: DictionaryEntryRecord[]): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['dictionarySources', 'dictionaryEntries'], 'readwrite');
    tx.objectStore('dictionarySources').put(source);
    const entriesStore = tx.objectStore('dictionaryEntries');
    for (const entry of entries) entriesStore.put(entry);
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
  });
}

export async function upsertDictionaryEntriesIntoSource(source: DictionarySourceRecord, entries: DictionaryEntryRecord[]): Promise<number> {
  const db = await openDatabase();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(['dictionarySources', 'dictionaryEntries'], 'readwrite');
    const sourcesStore = tx.objectStore('dictionarySources');
    const entriesStore = tx.objectStore('dictionaryEntries');
    const sourceIdIndex = entriesStore.index('sourceId');
    sourcesStore.put(source);
    for (const entry of entries) entriesStore.put(entry);

    let count = source.entryCount;
    const countRequest = sourceIdIndex.count(IDBKeyRange.only(source.id));
    countRequest.onsuccess = () => {
      count = countRequest.result;
      sourcesStore.put({ ...source, entryCount: count });
    };
    countRequest.onerror = () => reject(countRequest.error);
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve(count);
  });
}

export async function consolidateLegacyAiDictionaries(): Promise<void> {
  const sources = await getDictionarySources();
  const legacySources = sources.filter((source) =>
    source.id.startsWith('ai-dictionary-') && !source.id.startsWith('ai-dictionary-global-')
  );
  if (!legacySources.length) return;

  const allEntries = await getAll('dictionaryEntries');

  for (const language of ['fr', 'en'] as SourceLanguage[]) {
    const sourceIds = new Set(legacySources.filter((source) => source.language === language).map((source) => source.id));
    if (!sourceIds.size) continue;

    const globalSourceId = getGlobalAiDictionarySourceId(language);
    const globalSourceName = getGlobalAiDictionarySourceName(language);
    const migratedEntries = allEntries
      .filter((entry) => sourceIds.has(entry.sourceId))
      .map((entry) => ({
        ...entry,
        id: `dict_global_ai_${language}_${entry.normalized}`,
        sourceId: globalSourceId,
        sourceName: globalSourceName,
        lookupKey: `${language}:${entry.normalized}`,
        language,
        generatedByAi: true
      }));

    if (migratedEntries.length) {
      await upsertDictionaryEntriesIntoSource(
        {
          id: globalSourceId,
          name: globalSourceName,
          language,
          format: 'json',
          entryCount: migratedEntries.length,
          createdAt: nowString()
        },
        migratedEntries
      );
    }
  }

  for (const source of legacySources) await deleteDictionarySource(source.id);
}

function nowString(): string {
  return new Date().toISOString();
}

export async function getDictionarySources(): Promise<DictionarySourceRecord[]> {
  return (await getAll('dictionarySources')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteDictionarySource(sourceId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['dictionarySources', 'dictionaryEntries'], 'readwrite');
    tx.objectStore('dictionarySources').delete(sourceId);
    const index = tx.objectStore('dictionaryEntries').index('sourceId');
    const request = index.openCursor(IDBKeyRange.only(sourceId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
  });
}

export async function deleteBookCascade(bookId: string): Promise<void> {
  const pages = await getPagesByBook(bookId);
  const words = await getVocabularyByBook(bookId);
  const ai = (await getAll('aiCache')).filter((item) => item.bookId === bookId);
  await Promise.all([
    ...pages.map((page) => deleteByKey('pages', page.id)),
    ...words.map((word) => deleteByKey('vocabulary', word.id)),
    ...ai.map((item) => deleteByKey('aiCache', item.id)),
    deleteByKey('progress', bookId),
    deleteByKey('books', bookId)
  ]);
}

export async function exportAllData(): Promise<string> {
  const [books, pages, progress, vocabulary, aiCache, settings, dictionarySources, dictionaryEntries] = await Promise.all([
    getAll('books'),
    getAll('pages'),
    getAll('progress'),
    getAll('vocabulary'),
    getAll('aiCache'),
    getSettings(),
    getAll('dictionarySources'),
    getAll('dictionaryEntries')
  ]);

  const booksWithBase64 = await Promise.all(
    books.map(async (book) => ({
      ...book,
      fileBlob: await blobToDataUrl(book.fileBlob)
    }))
  );

  const safeSettings = { ...settings, aiApiKeys: { openai: '', gemini: '', groq: '', openrouter: '', mistral: '' }, openAiApiKey: '', openAiModel: undefined };
  return JSON.stringify({ version: 2, books: booksWithBase64, pages, progress, vocabulary, aiCache, settings: safeSettings, dictionarySources, dictionaryEntries }, null, 2);
}

export async function importAllData(json: string): Promise<void> {
  const data = JSON.parse(json);
  if (!data || ![1, 2].includes(data.version)) throw new Error('Unsupported backup format');

  await Promise.all(['books', 'pages', 'progress', 'vocabulary', 'aiCache', 'dictionarySources', 'dictionaryEntries'].map((store) => clearStore(store as StoreName)));

  for (const rawBook of data.books || []) {
    const blob = dataUrlToBlob(rawBook.fileBlob);
    await put('books', { ...rawBook, fileBlob: blob });
  }
  for (const page of data.pages || []) await put('pages', page);
  for (const item of data.progress || []) await put('progress', item);
  for (const word of data.vocabulary || []) await put('vocabulary', word);
  for (const item of data.aiCache || []) await put('aiCache', item);
  for (const source of data.dictionarySources || []) await put('dictionarySources', source);
  for (const entry of data.dictionaryEntries || []) await put('dictionaryEntries', entry);
  if (data.settings) await saveSettings(normalizeSettings({ ...DEFAULT_SETTINGS, ...data.settings }));
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = /data:(.*?);base64/.exec(header)?.[1] || 'application/octet-stream';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
