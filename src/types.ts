export type UiLanguage = 'ru' | 'en' | 'fr';
export type SourceLanguage = 'en' | 'fr';
export type ViewName = 'library' | 'reader' | 'vocabulary' | 'flashcards' | 'settings';
export type AiProvider = 'openai' | 'gemini' | 'groq' | 'openrouter' | 'mistral';

export interface AppSettings {
  uiLanguage: UiLanguage;
  aiProvider: AiProvider;
  aiApiKeys: Record<AiProvider, string>;
  aiModels: Record<AiProvider, string>;
  defaultSourceLanguage: SourceLanguage;
  hasRequestedPersistentStorage: boolean;
  quizQuestionLanguage: 'ru' | 'source';
  openAiApiKey?: string;
  openAiModel?: string;
}

export interface BookRecord {
  id: string;
  title: string;
  sourceLanguage: SourceLanguage;
  fileName: string;
  fileBlob: Blob;
  pageCount: number;
  createdAt: string;
  lastOpenedAt: string;
}

export interface PageTextRecord {
  id: string;
  bookId: string;
  pageNumber: number;
  text: string;
}

export interface ReadingProgressRecord {
  bookId: string;
  currentPage: number;
  updatedAt: string;
}

export interface DictionaryEntry {
  source: string;
  normalized: string;
  language: SourceLanguage;
  translationsRu: string[];
  partOfSpeech?: string;
  examples?: string[];
  frequency?: number;
  lemma?: string;
  grammarRu?: string;
  generatedByAi?: boolean;
  aiProvider?: AiProvider;
}

export interface DictionarySourceRecord {
  id: string;
  name: string;
  language: SourceLanguage;
  format: 'json' | 'csv' | 'tsv' | 'dsl' | 'unknown';
  entryCount: number;
  createdAt: string;
}

export interface DictionaryEntryRecord extends DictionaryEntry {
  id: string;
  lookupKey: string;
  sourceId: string;
  sourceName: string;
  importedAt: string;
}

export interface ParsedDictionaryImport {
  source: DictionarySourceRecord;
  entries: DictionaryEntryRecord[];
}

export interface VocabularyRecord {
  id: string;
  bookId: string;
  sourceLanguage: SourceLanguage;
  word: string;
  lemma?: string;
  translationRu: string;
  exampleSentence?: string;
  status: 'new' | 'learning' | 'known';
  createdAt: string;
  nextReviewAt?: string;
  ease: number;
  intervalDays: number;
}

export interface AiExplanationRecord {
  id: string;
  bookId: string;
  sourceLanguage: SourceLanguage;
  mode: 'word' | 'sentence' | 'grammar' | 'simplify' | 'quiz' | 'translation';
  inputText: string;
  context?: string;
  responseRu: string;
  createdAt: string;
}
