import type { DictionaryEntryRecord, DictionarySourceRecord, ParsedDictionaryImport, SourceLanguage } from '../../types';
import { generateId, normalizeWord } from '../../utils/text';

type RawEntry = {
  word?: string;
  source?: string;
  headword?: string;
  translation?: string;
  translationRu?: string;
  translationsRu?: string[];
  translations?: string[];
  partOfSpeech?: string;
  pos?: string;
  examples?: string[];
};

export async function parseDictionaryFile(file: File, language: SourceLanguage, sourceName?: string): Promise<ParsedDictionaryImport> {
  const text = await file.text();
  const format = detectFormat(file.name, text);
  const now = new Date().toISOString();
  const sourceId = generateId('dict');
  const name = sourceName?.trim() || file.name.replace(/\.[^.]+$/, '') || `${language.toUpperCase()} → RU`;

  let entries: DictionaryEntryRecord[] = [];
  if (format === 'json') entries = parseJson(text, language, sourceId, name, now);
  else if (format === 'dsl') entries = parseDsl(text, language, sourceId, name, now);
  else entries = parseDelimited(text, language, sourceId, name, now, format === 'tsv' ? '\t' : undefined);

  const unique = dedupe(entries);
  const source: DictionarySourceRecord = {
    id: sourceId,
    name,
    language,
    format,
    entryCount: unique.length,
    createdAt: now
  };

  return { source, entries: unique };
}

function detectFormat(fileName: string, text: string): DictionarySourceRecord['format'] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.dsl')) return 'dsl';
  if (lower.endsWith('.tsv')) return 'tsv';
  if (lower.endsWith('.csv')) return 'csv';
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (/^#NAME|^#INDEX_LANGUAGE|^#CONTENTS_LANGUAGE/m.test(text)) return 'dsl';
  if (text.includes('\t')) return 'tsv';
  if (text.includes(',')) return 'csv';
  return 'unknown';
}

function parseJson(text: string, language: SourceLanguage, sourceId: string, sourceName: string, importedAt: string): DictionaryEntryRecord[] {
  const data = JSON.parse(text);
  const rows: RawEntry[] = [];

  if (Array.isArray(data)) {
    rows.push(...data);
  } else if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') rows.push({ word: key, translationRu: value });
      else if (Array.isArray(value)) rows.push({ word: key, translationsRu: value.map(String) });
      else if (value && typeof value === 'object') rows.push({ word: key, ...(value as Record<string, unknown>) } as RawEntry);
    }
  }

  return rows.map((row) => buildEntry(row.word || row.source || row.headword || '', row.translationsRu || row.translations || splitTranslations(row.translationRu || row.translation || ''), language, sourceId, sourceName, importedAt, row.partOfSpeech || row.pos, row.examples)).filter(Boolean) as DictionaryEntryRecord[];
}

function parseDelimited(text: string, language: SourceLanguage, sourceId: string, sourceName: string, importedAt: string, forcedDelimiter?: string): DictionaryEntryRecord[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  if (!lines.length) return [];
  const delimiter = forcedDelimiter || guessDelimiter(lines[0]);
  const maybeHeader = splitDelimitedLine(lines[0], delimiter).map((cell) => cell.toLowerCase());
  const hasHeader = maybeHeader.some((cell) => ['word', 'source', 'headword', 'translation', 'translationru', 'translationsru', 'pos', 'partofspeech'].includes(cell.replace(/[^a-z]/g, '')));
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.map((line) => {
    const columns = splitDelimitedLine(line, delimiter);
    const word = columns[0] || '';
    const translation = columns[1] || '';
    const pos = columns[2] || undefined;
    return buildEntry(word, splitTranslations(translation), language, sourceId, sourceName, importedAt, pos);
  }).filter(Boolean) as DictionaryEntryRecord[];
}

function parseDsl(text: string, language: SourceLanguage, sourceId: string, sourceName: string, importedAt: string): DictionaryEntryRecord[] {
  const entries: DictionaryEntryRecord[] = [];
  let headword = '';
  let body: string[] = [];

  const flush = () => {
    if (!headword || !body.length) return;
    const cleanedBody = cleanupDslMarkup(body.join(' '));
    const translations = splitTranslations(cleanedBody).slice(0, 12);
    const entry = buildEntry(headword, translations, language, sourceId, sourceName, importedAt);
    if (entry) entries.push(entry);
  };

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.startsWith('#')) continue;
    if (/^\s/.test(rawLine)) {
      body.push(rawLine.trim());
    } else {
      flush();
      headword = rawLine.trim();
      body = [];
    }
  }
  flush();
  return entries;
}

function buildEntry(word: string, rawTranslations: string[], language: SourceLanguage, sourceId: string, sourceName: string, importedAt: string, partOfSpeech?: string, examples?: string[]): DictionaryEntryRecord | null {
  const normalized = normalizeWord(word);
  if (!normalized) return null;
  const translationsRu = rawTranslations.map(cleanTranslation).filter(Boolean).filter((item, index, array) => array.indexOf(item) === index).slice(0, 12);
  if (!translationsRu.length) return null;

  return {
    id: `${sourceId}:${language}:${normalized}`,
    lookupKey: `${language}:${normalized}`,
    source: word.trim(),
    normalized,
    language,
    translationsRu,
    partOfSpeech: partOfSpeech?.trim() || undefined,
    examples: examples?.map(String).filter(Boolean).slice(0, 5),
    sourceId,
    sourceName,
    importedAt
  };
}

function dedupe(entries: DictionaryEntryRecord[]): DictionaryEntryRecord[] {
  const map = new Map<string, DictionaryEntryRecord>();
  for (const entry of entries) {
    const existing = map.get(entry.id);
    if (!existing) {
      map.set(entry.id, entry);
    } else {
      map.set(entry.id, {
        ...existing,
        translationsRu: Array.from(new Set([...existing.translationsRu, ...entry.translationsRu])).slice(0, 12)
      });
    }
  }
  return Array.from(map.values());
}

function splitTranslations(value: string): string[] {
  return value
    .replace(/<[^>]+>/g, ' ')
    .split(/[,;|/•]+|\s{2,}/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanTranslation(value: string): string {
  return value
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/\([^)]{30,}\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanupDslMarkup(value: string): string {
  return value
    .replace(/\[\/?[^\]]+\]/g, ' ')
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/<<[^>]+>>/g, ' ')
    .replace(/\\\[/g, '[')
    .replace(/\\\]/g, ']')
    .replace(/\s+/g, ' ')
    .trim();
}

function guessDelimiter(line: string): string {
  if (line.includes('\t')) return '\t';
  if (line.includes(';') && !line.includes(',')) return ';';
  return ',';
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}
