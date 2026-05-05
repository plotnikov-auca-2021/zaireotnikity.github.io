import type { AiExplanationRecord, AiProvider, DictionaryEntryRecord, DictionarySourceRecord, PageTextRecord, SourceLanguage } from '../../types';
import { getByKey, importDictionarySource, put } from '../../storage/db';
import { lookupOfflineDictionary } from '../dictionary/dictionaryService';
import { displayCleanWord, nowIso, normalizeWord, simpleHash, splitIntoSentences, splitSentenceIntoParts } from '../../utils/text';

export interface AiRequestParams {
  provider: AiProvider;
  apiKey: string;
  model: string;
  bookId: string;
  sourceLanguage: SourceLanguage;
  mode: AiExplanationRecord['mode'];
  inputText: string;
  context?: string;
  forceRefresh?: boolean;
}

export interface PretranslateBookParams {
  provider: AiProvider;
  apiKey: string;
  model: string;
  bookId: string;
  bookTitle?: string;
  sourceLanguage: SourceLanguage;
  pages: PageTextRecord[];
  onProgress?: (progress: {
    pageNumber: number;
    pageCount: number;
    translated: number;
    total: number;
    wordStage?: 'idle' | 'collecting' | 'ai' | 'saved' | 'failed';
    unknownWords?: number;
    savedWords?: number;
  }) => void;
}

interface AiWordEntry {
  word: string;
  lemma?: string;
  translationRu?: string;
  translationsRu?: string[];
  grammar?: string;
  grammarRu?: string;
  partOfSpeech?: string;
}

export async function getAiExplanation(params: AiRequestParams): Promise<{ text: string; cached: boolean }> {
  const cacheId = buildCacheId(params);
  if (!params.forceRefresh) {
    const cached = await getByKey('aiCache', cacheId);
    if (cached) return { text: cached.responseRu, cached: true };
  }
  const prompt = buildPrompt(params);
  const text = await callSelectedProvider(params.provider, params.apiKey, params.model, prompt);
  await put('aiCache', {
    id: cacheId,
    bookId: params.bookId,
    sourceLanguage: params.sourceLanguage,
    mode: params.mode,
    inputText: params.inputText,
    context: params.context,
    responseRu: text,
    createdAt: nowIso()
  });
  return { text, cached: false };
}

export async function getCachedSentenceTranslation(bookId: string, sourceLanguage: SourceLanguage, sentence: string): Promise<string | null> {
  const cached = await getByKey('aiCache', buildTranslationCacheId(bookId, sourceLanguage, sentence));
  return cached?.responseRu || null;
}

export async function pretranslateBook(params: PretranslateBookParams): Promise<{ translated: number; total: number; aiDictionaryEntries: number }> {
  if (!params.apiKey.trim()) throw new Error(`Missing ${providerName(params.provider)} API key`);

  const pageSentences = params.pages.map((page) => ({
    page,
    sentences: splitIntoSentences(page.text).map((sentence) => sentence.trim()).filter(Boolean)
  }));
  const total = pageSentences.reduce((sum, item) => sum + item.sentences.length, 0);
  let translated = 0;
  let aiDictionaryEntries = 0;

  for (const item of pageSentences) {
    const missing: string[] = [];
    for (const sentence of item.sentences) {
      const cached = await getByKey('aiCache', buildTranslationCacheId(params.bookId, params.sourceLanguage, sentence));
      if (cached?.responseRu) {
        translated += 1;
      } else {
        missing.push(sentence);
      }
    }

    for (const chunk of chunkSentences(missing)) {
      const translations = await translateSentenceBatch({ ...params, sentences: chunk });
      await Promise.all(chunk.map((sentence, index) => put('aiCache', {
        id: buildTranslationCacheId(params.bookId, params.sourceLanguage, sentence),
        bookId: params.bookId,
        sourceLanguage: params.sourceLanguage,
        mode: 'translation',
        inputText: sentence,
        responseRu: translations[index] || '',
        createdAt: nowIso()
      })));
      translated += chunk.length;
      params.onProgress?.({ pageNumber: item.page.pageNumber, pageCount: params.pages.length, translated, total });
    }

    params.onProgress?.({ pageNumber: item.page.pageNumber, pageCount: params.pages.length, translated, total, wordStage: 'collecting' });
    try {
      const savedForPage = await enrichUnknownWordsForPage(params, item.page, item.sentences);
      aiDictionaryEntries += savedForPage;
      params.onProgress?.({
        pageNumber: item.page.pageNumber,
        pageCount: params.pages.length,
        translated,
        total,
        wordStage: 'saved',
        savedWords: savedForPage
      });
    } catch {
      // Word enrichment should not prevent the translated book from being usable.
      params.onProgress?.({
        pageNumber: item.page.pageNumber,
        pageCount: params.pages.length,
        translated,
        total,
        wordStage: 'failed'
      });
    }

    params.onProgress?.({ pageNumber: item.page.pageNumber, pageCount: params.pages.length, translated, total });
  }

  return { translated, total, aiDictionaryEntries };
}

export async function checkAiApi(provider: AiProvider, apiKey: string, model: string): Promise<boolean> {
  const text = await callSelectedProvider(provider, apiKey, model, 'Ответь одним словом по-русски: готово');
  return text.toLowerCase().includes('готов') || text.trim().length > 0;
}

export function providerName(provider: AiProvider): string {
  const names: Record<AiProvider, string> = {
    openai: 'OpenAI',
    gemini: 'Google Gemini',
    groq: 'Groq',
    openrouter: 'OpenRouter',
    mistral: 'Mistral AI'
  };
  return names[provider];
}

function buildCacheId(params: AiRequestParams): string {
  return `ai_${simpleHash([params.bookId, params.sourceLanguage, params.mode, params.inputText, params.context || ''].join('|'))}`;
}

function buildTranslationCacheId(bookId: string, sourceLanguage: SourceLanguage, sentence: string): string {
  return `ai_${simpleHash([bookId, sourceLanguage, 'translation', sentence, ''].join('|'))}`;
}

function languageName(language: SourceLanguage): string {
  return language === 'fr' ? 'французского' : 'английского';
}

function sourceLanguageLabel(language: SourceLanguage): string {
  return language === 'fr' ? 'French' : 'English';
}

function buildPrompt(params: AiRequestParams): string {
  const lang = languageName(params.sourceLanguage);
  const context = params.context ? `\nКонтекст: ${params.context}` : '';
  const common = `Ты — внимательный преподаватель ${lang} языка для русскоговорящего ученика. Пиши по-русски, ясно и кратко. Не добавляй лишнюю теорию. Если текст неоднозначен, объясни основной вариант и возможную альтернативу.`;
  if (params.mode === 'translation') return `${common}\n\nПредложение: ${params.inputText}${context}\n\nДай только естественный перевод на русский язык без комментариев.`;
  if (params.mode === 'word') return `${common}\n\nСлово: ${params.inputText}${context}\n\nДай ответ в таком формате:\n1) Перевод\n2) Часть речи\n3) Как используется в этом контексте\n4) 2 коротких примера с переводом`;
  if (params.mode === 'sentence') return `${common}\n\nПредложение: ${params.inputText}${context}\n\nДай ответ в таком формате:\n1) Естественный перевод\n2) Дословная структура\n3) Ключевые слова\n4) Что здесь важно для понимания`;
  if (params.mode === 'grammar') return `${common}\n\nТекст: ${params.inputText}${context}\n\nОбъясни грамматику в таком формате:\n1) Главная конструкция\n2) Почему она используется\n3) Как перевести на русский\n4) Похожий пример`;
  if (params.mode === 'simplify') return `${common}\n\nТекст: ${params.inputText}${context}\n\nСделай:\n1) Простое объяснение по-русски\n2) Упрощённую версию на исходном языке\n3) 3 трудных слова с переводом`;
  return `${common}\n\nТекст: ${params.inputText}${context}\n\nСоставь мини-тест для понимания:\n1) 3 вопроса\n2) варианты ответа A/B/C\n3) правильные ответы\n4) краткое объяснение каждого ответа`;
}

async function translateSentenceBatch(params: PretranslateBookParams & { sentences: string[] }): Promise<string[]> {
  if (!params.sentences.length) return [];
  const lang = languageName(params.sourceLanguage);
  const prompt = [
    `Ты — профессиональный переводчик с ${lang} языка на русский.`,
    'Переведи каждое предложение естественно, сохрани порядок и количество элементов.',
    'Ответь только валидным JSON-массивом строк. Никакого Markdown, нумерации или пояснений.',
    `Предложения: ${JSON.stringify(params.sentences)}`
  ].join('\n');

  const raw = await callSelectedProvider(params.provider, params.apiKey, params.model, prompt);
  return parseTranslationArray(raw, params.sentences.length);
}

async function enrichUnknownWordsForPage(params: PretranslateBookParams, page: PageTextRecord, sentences: string[]): Promise<number> {
  const unknownWords = await collectUnknownWords(sentences, params.sourceLanguage);
  if (!unknownWords.length) return 0;

  params.onProgress?.({
    pageNumber: page.pageNumber,
    pageCount: params.pages.length,
    translated: 0,
    total: 0,
    wordStage: 'ai',
    unknownWords: unknownWords.length
  });

  const entries: AiWordEntry[] = [];
  for (const chunk of chunkWords(unknownWords)) {
    const raw = await callSelectedProvider(
      params.provider,
      params.apiKey,
      params.model,
      buildUnknownWordsPrompt(params.sourceLanguage, chunk, sentences)
    );
    entries.push(...parseAiWordEntries(raw));
  }

  const dictionaryEntries = buildAiDictionaryEntries({
    provider: params.provider,
    bookId: params.bookId,
    bookTitle: params.bookTitle,
    sourceLanguage: params.sourceLanguage,
    aiEntries: entries,
    fallbackWords: unknownWords
  });

  if (!dictionaryEntries.length) return 0;

  const source: DictionarySourceRecord = {
    id: buildAiDictionarySourceId(params.bookId, params.sourceLanguage),
    name: `AI dictionary · ${params.bookTitle || params.bookId}`,
    language: params.sourceLanguage,
    format: 'json',
    entryCount: dictionaryEntries.length,
    createdAt: nowIso()
  };

  await importDictionarySource(source, dictionaryEntries);
  return dictionaryEntries.length;
}

async function collectUnknownWords(sentences: string[], language: SourceLanguage): Promise<string[]> {
  const unique = new Map<string, string>();

  for (const sentence of sentences) {
    for (const part of splitSentenceIntoParts(sentence)) {
      if (part.type !== 'word') continue;
      const clean = displayCleanWord(part.value);
      const normalized = normalizeWord(clean);
      if (!shouldCheckWord(normalized)) continue;
      if (!unique.has(normalized)) unique.set(normalized, clean);
    }
  }

  const unknown: string[] = [];
  for (const [normalized, original] of unique) {
    const existing = await lookupOfflineDictionary(original, language);
    if (!existing) unknown.push(original);
  }

  return unknown.slice(0, 80);
}

function shouldCheckWord(normalized: string): boolean {
  if (!normalized || normalized.length < 2) return false;
  if (/^\d+$/.test(normalized)) return false;
  if (/^[ivxlcdm]+$/i.test(normalized)) return false;
  return true;
}

function buildUnknownWordsPrompt(language: SourceLanguage, words: string[], sentences: string[]): string {
  return [
    `You are helping a Russian-speaking learner read a ${sourceLanguageLabel(language)} book.`,
    'For each unknown word or inflected form, identify the dictionary form and the most likely Russian meaning in context.',
    'Return ONLY a valid JSON array. No Markdown. No comments outside JSON.',
    'Each item must have this shape:',
    '[{"word":"original form","lemma":"dictionary form","translationRu":"short Russian translation","grammar":"short grammar note in Russian","partOfSpeech":"noun/verb/adjective/etc. in Russian"}]',
    'If a word is a contraction or elision, keep the original in "word" and explain the useful dictionary form in "lemma".',
    `Unknown words: ${JSON.stringify(words)}`,
    `Page context: ${JSON.stringify(sentences.slice(0, 18))}`
  ].join('\n');
}

function parseAiWordEntries(raw: string): AiWordEntry[] {
  const jsonCandidate = extractJsonArray(raw.trim());
  if (!jsonCandidate) return [];
  try {
    const parsed = JSON.parse(jsonCandidate);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        word: String(item?.word || '').trim(),
        lemma: String(item?.lemma || '').trim(),
        translationRu: String(item?.translationRu || item?.translation || '').trim(),
        translationsRu: Array.isArray(item?.translationsRu) ? item.translationsRu.map((v: unknown) => String(v).trim()).filter(Boolean) : undefined,
        grammar: String(item?.grammar || item?.grammarRu || '').trim(),
        grammarRu: String(item?.grammarRu || item?.grammar || '').trim(),
        partOfSpeech: String(item?.partOfSpeech || '').trim()
      }))
      .filter((entry) => entry.word && (entry.translationRu || entry.translationsRu?.length));
  } catch {
    return [];
  }
}

function buildAiDictionaryEntries({
  provider,
  bookId,
  bookTitle,
  sourceLanguage,
  aiEntries,
  fallbackWords
}: {
  provider: AiProvider;
  bookId: string;
  bookTitle?: string;
  sourceLanguage: SourceLanguage;
  aiEntries: AiWordEntry[];
  fallbackWords: string[];
}): DictionaryEntryRecord[] {
  const fallbackByNorm = new Map(fallbackWords.map((word) => [normalizeWord(word), word]));
  const sourceId = buildAiDictionarySourceId(bookId, sourceLanguage);
  const now = nowIso();
  const result: DictionaryEntryRecord[] = [];
  const seen = new Set<string>();

  for (const aiEntry of aiEntries) {
    const original = aiEntry.word || fallbackByNorm.get(normalizeWord(aiEntry.lemma || '')) || '';
    const normalized = normalizeWord(original);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);

    const translationsRu = aiEntry.translationsRu?.length
      ? aiEntry.translationsRu
      : String(aiEntry.translationRu || '')
          .split(/[;,]/)
          .map((item) => item.trim())
          .filter(Boolean);

    if (!translationsRu.length) continue;

    result.push({
      id: `dict_${simpleHash([sourceId, normalized].join('|'))}`,
      lookupKey: `${sourceLanguage}:${normalized}`,
      sourceId,
      sourceName: `AI dictionary · ${bookTitle || bookId}`,
      importedAt: now,
      source: original,
      normalized,
      language: sourceLanguage,
      translationsRu,
      partOfSpeech: aiEntry.partOfSpeech || undefined,
      lemma: aiEntry.lemma || undefined,
      grammarRu: aiEntry.grammarRu || aiEntry.grammar || undefined,
      generatedByAi: true,
      aiProvider: provider
    });
  }

  return result;
}

function buildAiDictionarySourceId(bookId: string, sourceLanguage: SourceLanguage): string {
  return `ai-dictionary-${sourceLanguage}-${bookId}`;
}

function parseTranslationArray(raw: string, expectedCount: number): string[] {
  const trimmed = raw.trim();
  const jsonCandidate = extractJsonArray(trimmed);
  if (jsonCandidate) {
    try {
      const parsed = JSON.parse(jsonCandidate);
      if (Array.isArray(parsed)) {
        const values = parsed.map((item) => String(item || '').trim());
        if (values.length === expectedCount) return values;
        if (values.length > 0) return padTranslations(values, expectedCount);
      }
    } catch {
      // Fall back to line parsing below.
    }
  }

  const lines = trimmed
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]?\s*\d+[).:-]?\s*/, '').trim())
    .filter(Boolean);

  return padTranslations(lines, expectedCount);
}

function extractJsonArray(text: string): string | null {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return null;
}

function padTranslations(values: string[], expectedCount: number): string[] {
  const result = values.slice(0, expectedCount);
  while (result.length < expectedCount) result.push('');
  return result;
}

function chunkSentences(sentences: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const sentence of sentences) {
    const length = sentence.length;
    if (current.length && (current.length >= 10 || currentChars + length > 3600)) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(sentence);
    currentChars += length;
  }

  if (current.length) chunks.push(current);
  return chunks;
}

function chunkWords(words: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < words.length; i += 30) chunks.push(words.slice(i, i + 30));
  return chunks;
}

async function callSelectedProvider(provider: AiProvider, apiKey: string, model: string, prompt: string): Promise<string> {
  if (!apiKey.trim()) throw new Error(`Missing ${providerName(provider)} API key`);
  if (provider === 'openai') return callOpenAiResponsesApi(apiKey, model, prompt);
  if (provider === 'gemini') return callGeminiGenerateContentApi(apiKey, model, prompt);
  if (provider === 'groq') return callChatCompletionsApi({ apiKey, model, prompt, endpoint: 'https://api.groq.com/openai/v1/chat/completions', defaultModel: 'llama-3.3-70b-versatile', providerLabel: 'Groq' });
  if (provider === 'openrouter') return callChatCompletionsApi({ apiKey, model, prompt, endpoint: 'https://openrouter.ai/api/v1/chat/completions', defaultModel: 'openrouter/auto', providerLabel: 'OpenRouter', extraHeaders: { 'X-Title': 'EWA Reader Local PWA' } });
  return callChatCompletionsApi({ apiKey, model, prompt, endpoint: 'https://api.mistral.ai/v1/chat/completions', defaultModel: 'mistral-small-latest', providerLabel: 'Mistral AI' });
}

async function callOpenAiResponsesApi(apiKey: string, model: string, input: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
    body: JSON.stringify({ model: model.trim() || 'gpt-4.1-mini', input, store: false })
  });
  if (!response.ok) throw await buildApiError('OpenAI', response);
  return extractOpenAiOutputText(await response.json());
}

async function callGeminiGenerateContentApi(apiKey: string, model: string, input: string): Promise<string> {
  const selectedModel = encodeURIComponent(model.trim() || 'gemini-2.5-flash');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${encodeURIComponent(apiKey.trim())}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: input }] }], generationConfig: { temperature: 0.2 } })
  });
  if (!response.ok) throw await buildApiError('Google Gemini', response);
  return extractGeminiText(await response.json());
}

async function callChatCompletionsApi({ apiKey, model, prompt, endpoint, defaultModel, providerLabel, extraHeaders = {} }: { apiKey: string; model: string; prompt: string; endpoint: string; defaultModel: string; providerLabel: string; extraHeaders?: Record<string, string>; }): Promise<string> {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}`, ...extraHeaders },
    body: JSON.stringify({ model: model.trim() || defaultModel, messages: [{ role: 'user', content: prompt }], temperature: 0.2 })
  });
  if (!response.ok) throw await buildApiError(providerLabel, response);
  return extractChatCompletionText(await response.json());
}

async function buildApiError(providerLabel: string, response: Response): Promise<Error> {
  const errorText = await response.text();
  return new Error(`${providerLabel} API error ${response.status}: ${errorText}`);
}

function extractOpenAiOutputText(data: any): string {
  if (typeof data.output_text === 'string') return data.output_text;
  if (Array.isArray(data.output)) {
    const parts: string[] = [];
    for (const item of data.output) if (Array.isArray(item.content)) for (const content of item.content) {
      if (typeof content.text === 'string') parts.push(content.text);
      if (typeof content.output_text === 'string') parts.push(content.output_text);
    }
    if (parts.length) return parts.join('\n').trim();
  }
  return JSON.stringify(data, null, 2);
}

function extractGeminiText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const text = parts.map((part) => part.text).filter(Boolean).join('\n').trim();
    if (text) return text;
  }
  return JSON.stringify(data, null, 2);
}

function extractChatCompletionText(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content.map((part) => part.text || part.content || '').filter(Boolean).join('\n').trim();
    if (text) return text;
  }
  return JSON.stringify(data, null, 2);
}
