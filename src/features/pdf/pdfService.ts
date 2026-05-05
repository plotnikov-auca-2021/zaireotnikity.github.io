import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type { BookRecord, PageTextRecord, SourceLanguage } from '../../types';
import { generateId, nowIso } from '../../utils/text';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export async function extractPdfBook(file: File, sourceLanguage: SourceLanguage): Promise<{ book: BookRecord; pages: PageTextRecord[] }> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const bookId = generateId('book');
  const now = nowIso();

  const book: BookRecord = {
    id: bookId,
    title: file.name.replace(/\.pdf$/i, ''),
    sourceLanguage,
    fileName: file.name,
    fileBlob: new Blob([arrayBuffer], { type: file.type || 'application/pdf' }),
    pageCount: pdf.numPages,
    createdAt: now,
    lastOpenedAt: now
  };

  const pages: PageTextRecord[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    pages.push({
      id: `${bookId}_${pageNumber}`,
      bookId,
      pageNumber,
      text
    });
  }

  return { book, pages };
}
