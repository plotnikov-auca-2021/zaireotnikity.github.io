import { ChangeEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { Select } from '../components/Select';
import { TextInput } from '../components/TextInput';
import { lookupOfflineDictionary } from '../features/dictionary/dictionaryService';
import { parseDictionaryFile } from '../features/dictionary/importDictionary';
import { scheduleReview, type ReviewQuality } from '../features/flashcards/spacedRepetition';
import { getAiExplanation, checkAiApi, pretranslateBook, providerName } from '../features/openai/openaiClient';
import { extractPdfBook } from '../features/pdf/pdfService';
import { fetchPreparedCatalog, importPreparedBook, type PreparedBookCatalogItem } from '../features/preparedBooksService';
import { makeTranslator } from '../i18n/translations';
import {
  AI_PROVIDERS,
  consolidateLegacyAiDictionaries,
  DEFAULT_AI_MODELS,
  DEFAULT_SETTINGS,
  deleteBookCascade,
  deleteByKey,
  deleteDictionarySource,
  exportAllData,
  getAll,
  getByKey,
  getDictionarySources,
  getPagesByBook,
  getSettings,
  getVocabularyByBook,
  importAllData,
  importDictionarySource,
  put,
  saveSettings
} from '../storage/db';
import type {
  AiExplanationRecord,
  AiProvider,
  AppSettings,
  BookRecord,
  DictionaryEntry,
  DictionarySourceRecord,
  PageTextRecord,
  ReadingProgressRecord,
  SourceLanguage,
  UiLanguage,
  ViewName,
  VocabularyRecord
} from '../types';
import { displayCleanWord, generateId, nowIso, splitIntoSentences, splitSentenceIntoParts } from '../utils/text';

interface SelectedWordState {
  word: string;
  sentence: string;
  dictionaryEntry: DictionaryEntry | null;
  loading: boolean;
  saved: boolean;
}

interface AiPanelState {
  title: string;
  mode: AiExplanationRecord['mode'];
  inputText: string;
  text: string;
  loading: boolean;
  cached?: boolean;
}

export function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [view, setView] = useState<ViewName>('library');
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [preparedBooks, setPreparedBooks] = useState<PreparedBookCatalogItem[]>([]);
  const [preparedCatalogChecked, setPreparedCatalogChecked] = useState(false);
  const [preparedImportingId, setPreparedImportingId] = useState<string>('');
  const [activeBookId, setActiveBookId] = useState<string>('');
  const [pages, setPages] = useState<PageTextRecord[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [vocabulary, setVocabulary] = useState<VocabularyRecord[]>([]);
  const [dictionarySources, setDictionarySources] = useState<DictionarySourceRecord[]>([]);
  const [message, setMessage] = useState<string>('');
  const [busy, setBusy] = useState<string>('');
  const [selectedWord, setSelectedWord] = useState<SelectedWordState | null>(null);
  const [aiPanel, setAiPanel] = useState<AiPanelState | null>(null);
  const [sentenceTranslations, setSentenceTranslations] = useState<Record<string, string>>({});
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [flashcardAnswerVisible, setFlashcardAnswerVisible] = useState(false);
  const importRef = useRef<HTMLInputElement | null>(null);

  const t = useMemo(() => makeTranslator(settings.uiLanguage), [settings.uiLanguage]);
  const activeBook = books.find((book) => book.id === activeBookId) || null;
  const activePage = pages.find((page) => page.pageNumber === currentPage) || null;
  const localBookIds = useMemo(() => new Set(books.map((book) => book.id)), [books]);

  const loadPreparedCatalog = useCallback(async () => {
    setPreparedCatalogChecked(false);
    const items = await fetchPreparedCatalog();
    setPreparedBooks(items);
    setPreparedCatalogChecked(true);
  }, []);

  const refreshSentenceTranslations = useCallback(async (bookId: string) => {
    const aiItems = await getAll('aiCache');
    const translations: Record<string, string> = {};
    for (const item of aiItems) {
      if (item.bookId === bookId && item.mode === 'translation' && item.responseRu) {
        translations[item.inputText] = item.responseRu;
      }
    }
    setSentenceTranslations(translations);
  }, []);

  const loadInitial = useCallback(async () => {
    await consolidateLegacyAiDictionaries();
    const savedSettings = await getSettings();
    setSettings(savedSettings);

    const savedBooks = await getAll('books');
    const sortedBooks = savedBooks.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
    setBooks(sortedBooks);
    setVocabulary(await getVocabularyByBook());
    setDictionarySources(await getDictionarySources());

    if (sortedBooks.length) {
      const lastBook = sortedBooks[0];
      setActiveBookId(lastBook.id);
      const lastPages = await getPagesByBook(lastBook.id);
      setPages(lastPages);
      await refreshSentenceTranslations(lastBook.id);
      const progress = await getByKey('progress', lastBook.id);
      setCurrentPage(progress?.currentPage || 1);
    }
  }, [refreshSentenceTranslations]);

  useEffect(() => {
    void loadInitial();
    void loadPreparedCatalog();
  }, [loadInitial, loadPreparedCatalog]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
    }
  }, []);

  const openBook = async (bookId: string) => {
    const book = books.find((item) => item.id === bookId);
    if (!book) return;
    const bookPages = await getPagesByBook(bookId);
    const progress = await getByKey('progress', bookId);
    const updatedBook = { ...book, lastOpenedAt: nowIso() };
    await put('books', updatedBook);
    setBooks((prev) => prev.map((item) => (item.id === bookId ? updatedBook : item)).sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt)));
    setActiveBookId(bookId);
    setPages(bookPages);
    await refreshSentenceTranslations(bookId);
    setCurrentPage(progress?.currentPage || 1);
    setView('reader');
  };

  const persistProgress = async (bookId: string, page: number) => {
    const record: ReadingProgressRecord = { bookId, currentPage: page, updatedAt: nowIso() };
    await put('progress', record);
  };

  const goToPage = async (page: number) => {
    if (!activeBook) return;
    const bounded = Math.min(Math.max(1, page), activeBook.pageCount);
    setSelectedWord(null);
    setCurrentPage(bounded);
    await persistProgress(activeBook.id, bounded);
  };

  const translateUploadedBookIfAvailable = async (book: BookRecord, extractedPages: PageTextRecord[]) => {
    const provider = settings.aiProvider;
    const apiKey = settings.aiApiKeys[provider]?.trim() || '';
    const model = settings.aiModels[provider] || DEFAULT_AI_MODELS[provider];
    if (!apiKey) {
      setMessage(t('uploadDoneNoAutoTranslation'));
      return;
    }

    setBusy(t('bookTranslationStarting'));
    try {
      const result = await pretranslateBook({
        provider,
        apiKey,
        model,
        bookId: book.id,
        sourceLanguage: book.sourceLanguage,
        bookTitle: book.title,
        pages: extractedPages,
        onProgress: (progress) => {
          if (progress.wordStage === 'collecting') {
            setBusy(`${t('aiDictionaryCollecting')} · ${t('page')} ${progress.pageNumber}/${progress.pageCount}`);
          } else if (progress.wordStage === 'ai') {
            setBusy(`${t('aiDictionaryProgress')} ${progress.unknownWords || 0} · ${t('page')} ${progress.pageNumber}/${progress.pageCount}`);
          } else if (progress.wordStage === 'saved') {
            setBusy(`${t('aiDictionarySaved')} ${progress.savedWords || 0} · ${t('page')} ${progress.pageNumber}/${progress.pageCount}`);
          } else if (progress.wordStage === 'failed') {
            setBusy(`${t('aiDictionaryFailed')} · ${t('page')} ${progress.pageNumber}/${progress.pageCount}`);
          } else {
            setBusy(`${t('bookTranslationProgress')} ${progress.translated}/${progress.total} · ${t('page')} ${progress.pageNumber}/${progress.pageCount}`);
          }
        }
      });
      setDictionarySources(await getDictionarySources());
      await refreshSentenceTranslations(book.id);
      setMessage(`${t('bookTranslationDone')} ${result.translated}/${result.total} · ${t('aiDictionaryEntries')}: ${result.aiDictionaryEntries}`);
    } catch (error) {
      setMessage(`${t('bookTranslationFailed')}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy('');
    }
  };

  const uploadPdf = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(t('uploadProcessing'));
    setMessage('');
    try {
      const { book, pages: extractedPages } = await extractPdfBook(file, settings.defaultSourceLanguage);
      await put('books', book);
      await Promise.all(extractedPages.map((page) => put('pages', page)));
      await put('progress', { bookId: book.id, currentPage: 1, updatedAt: nowIso() });
      setBooks((prev) => [book, ...prev]);
      setActiveBookId(book.id);
      setPages(extractedPages);
      setCurrentPage(1);
      setMessage(t('uploadDone'));
      setView('reader');
      await translateUploadedBookIfAvailable(book, extractedPages);
    } catch (error) {
      setMessage(`${t('error')}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy('');
      event.target.value = '';
    }
  };


  const handleImportPreparedBook = async (item: PreparedBookCatalogItem) => {
    setPreparedImportingId(item.id);
    setBusy(t('preparedImporting'));
    setMessage('');
    try {
      const result = await importPreparedBook(item);
      const nextBooks = (await getAll('books')).sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
      const importedBook = nextBooks.find((book) => book.id === result.bookId);
      if (importedBook) {
        setBooks(nextBooks);
        setActiveBookId(importedBook.id);
        setPages(await getPagesByBook(importedBook.id));
        await refreshSentenceTranslations(importedBook.id);
        setCurrentPage((await getByKey('progress', importedBook.id))?.currentPage || 1);
        setView('reader');
      }
      setDictionarySources(await getDictionarySources());
      setMessage(`${t('preparedImportDone')}: ${result.title} · ${result.pageCount} ${t('page').toLowerCase()} · ${result.translations} ${t('preparedTranslations').toLowerCase()} · ${result.dictionaryEntries} ${t('preparedDictionaryEntries').toLowerCase()}`);
    } catch (error) {
      setMessage(`${t('preparedImportFailed')}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy('');
      setPreparedImportingId('');
    }
  };

  const handleDeleteBook = async (bookId: string) => {
    await deleteBookCascade(bookId);
    const nextBooks = (await getAll('books')).sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
    setBooks(nextBooks);
    if (activeBookId === bookId) {
      setActiveBookId(nextBooks[0]?.id || '');
      if (nextBooks[0]) {
        setPages(await getPagesByBook(nextBooks[0].id));
        await refreshSentenceTranslations(nextBooks[0].id);
        setCurrentPage((await getByKey('progress', nextBooks[0].id))?.currentPage || 1);
      } else {
        setPages([]);
        setSentenceTranslations({});
        setCurrentPage(1);
      }
    }
    setVocabulary(await getVocabularyByBook());
  };

  const selectWord = async (word: string, sentence: string) => {
    if (!activeBook) return;
    const clean = displayCleanWord(word);
    if (!clean) return;
    if (selectedWord?.word.toLowerCase() === clean.toLowerCase() && selectedWord.sentence === sentence) {
      setSelectedWord(null);
      return;
    }
    setSelectedWord({ word: clean, sentence, dictionaryEntry: null, loading: true, saved: false });
    const dictionaryEntry = await lookupOfflineDictionary(clean, activeBook.sourceLanguage);
    const existing = vocabulary.some((item) => item.word.toLowerCase() === clean.toLowerCase() && item.bookId === activeBook.id);
    setSelectedWord({ word: clean, sentence, dictionaryEntry, loading: false, saved: existing });
  };

  const saveSelectedWord = async () => {
    if (!selectedWord || !activeBook) return;
    const translation = selectedWord.dictionaryEntry?.translationsRu.join(', ') || '';
    const record: VocabularyRecord = {
      id: generateId('word'),
      bookId: activeBook.id,
      sourceLanguage: activeBook.sourceLanguage,
      word: selectedWord.word,
      lemma: selectedWord.dictionaryEntry?.lemma || selectedWord.dictionaryEntry?.normalized,
      translationRu: translation,
      exampleSentence: selectedWord.sentence,
      status: 'new',
      createdAt: nowIso(),
      nextReviewAt: nowIso(),
      ease: 2.5,
      intervalDays: 1
    };
    await put('vocabulary', record);
    setVocabulary(await getVocabularyByBook());
    setSelectedWord({ ...selectedWord, saved: true });
  };

  const runAi = async (mode: AiExplanationRecord['mode'], inputText: string, title: string, context?: string) => {
    if (!activeBook) return;
    const provider = settings.aiProvider;
    const apiKey = settings.aiApiKeys[provider]?.trim() || '';
    const model = settings.aiModels[provider] || DEFAULT_AI_MODELS[provider];
    if (!apiKey) {
      setMessage(t('aiNeedsKey'));
      setView('settings');
      return;
    }
    setAiPanel({ title, mode, inputText, text: '', loading: true });
    try {
      const response = await getAiExplanation({
        provider,
        apiKey,
        model,
        bookId: activeBook.id,
        sourceLanguage: activeBook.sourceLanguage,
        mode,
        inputText,
        context,
        quizQuestionLanguage: settings.quizQuestionLanguage
      });
      setAiPanel({ title, mode, inputText, text: response.text, loading: false, cached: response.cached });
    } catch (error) {
      setAiPanel({
        title,
        mode,
        inputText,
        text: `${t('error')}: ${error instanceof Error ? error.message : String(error)}`,
        loading: false
      });
    }
  };

  const saveCurrentSettings = async (next: AppSettings) => {
    setSettings(next);
    await saveSettings(next);
    setMessage(t('saved'));
  };

  const requestStorage = async () => {
    let granted = false;
    if ('storage' in navigator && 'persist' in navigator.storage) {
      granted = await navigator.storage.persist();
    }
    const next = { ...settings, hasRequestedPersistentStorage: true };
    await saveCurrentSettings(next);
    setMessage(granted ? t('storageGranted') : t('storageDenied'));
  };

  const exportBackup = async () => {
    const json = await exportAllData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ewa-reader-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      await importAllData(text);
      await loadInitial();
      setMessage(t('importOk'));
    } catch (error) {
      setMessage(`${t('error')}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      event.target.value = '';
    }
  };


  const importDictionary = async (file: File, language: SourceLanguage, sourceName: string) => {
    setBusy(t('dictionaryImporting'));
    setMessage('');
    try {
      const parsed = await parseDictionaryFile(file, language, sourceName);
      if (!parsed.entries.length) {
        setMessage(t('dictionaryImportEmpty'));
        return;
      }
      await importDictionarySource(parsed.source, parsed.entries);
      setDictionarySources(await getDictionarySources());
      setMessage(`${t('dictionaryImported')}: ${parsed.source.name} · ${parsed.source.entryCount}`);
    } catch (error) {
      setMessage(`${t('error')}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy('');
    }
  };

  const removeDictionary = async (sourceId: string) => {
    await deleteDictionarySource(sourceId);
    setDictionarySources(await getDictionarySources());
    setMessage(t('dictionaryDeleted'));
  };

  const reviewWords = vocabulary.filter((word) => word.status !== 'known');
  const currentFlashcard = reviewWords[flashcardIndex % Math.max(reviewWords.length, 1)];

  const reviewFlashcard = async (quality: ReviewQuality) => {
    if (!currentFlashcard) return;
    await put('vocabulary', scheduleReview(currentFlashcard, quality));
    const updated = await getVocabularyByBook();
    setVocabulary(updated);
    setFlashcardAnswerVisible(false);
    setFlashcardIndex((index) => index + 1);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{activeBook ? activeBook.title : t('appTitle')}</p>
          <h1>{titleForView(view, t)}</h1>
        </div>
        <span className="pill">RU</span>
      </header>

      {message && <div className="notice">{message}</div>}
      {busy && <div className="notice notice-busy">{busy}</div>}

      <main className="main-content">
        {view === 'library' && (
          <LibraryView
            t={t}
            settings={settings}
            books={books}
            preparedBooks={preparedBooks}
            preparedCatalogChecked={preparedCatalogChecked}
            preparedImportingId={preparedImportingId}
            localBookIds={localBookIds}
            onUpload={uploadPdf}
            onOpen={openBook}
            onDelete={handleDeleteBook}
            onImportPrepared={handleImportPreparedBook}
            onRefreshPrepared={loadPreparedCatalog}
          />
        )}

        {view === 'reader' && (
          <ReaderView
            t={t}
            book={activeBook}
            page={activePage}
            currentPage={currentPage}
            pageCount={activeBook?.pageCount || 0}
            sentenceTranslations={sentenceTranslations}
            selectedWord={selectedWord}
            onPageChange={goToPage}
            onSelectWord={selectWord}
            onClearSelectedWord={() => setSelectedWord(null)}
            onSaveSelectedWord={saveSelectedWord}
            onExplainSentence={(sentence) => runAi('sentence', sentence, t('explainSentence'))}
            onGrammar={(sentence) => runAi('grammar', sentence, t('grammar'))}
            onSimplify={(sentence) => runAi('simplify', sentence, t('simplify'))}
            onQuiz={(sentence) => runAi('quiz', sentence, t('quiz'))}
          />
        )}

        {view === 'vocabulary' && (
          <VocabularyView
            t={t}
            words={vocabulary}
            onDelete={async (id) => {
              await deleteByKey('vocabulary', id);
              setVocabulary(await getVocabularyByBook());
            }}
            onMarkKnown={async (word) => {
              await put('vocabulary', { ...word, status: 'known' });
              setVocabulary(await getVocabularyByBook());
            }}
          />
        )}

        {view === 'flashcards' && (
          <FlashcardsView
            t={t}
            word={currentFlashcard}
            answerVisible={flashcardAnswerVisible}
            onShowAnswer={() => setFlashcardAnswerVisible(true)}
            onReview={reviewFlashcard}
          />
        )}

        {view === 'settings' && (
          <SettingsView
            t={t}
            settings={settings}
            onSave={saveCurrentSettings}
            onDeleteKey={() => saveCurrentSettings({ ...settings, aiApiKeys: { ...settings.aiApiKeys, [settings.aiProvider]: '' } })}
            onRequestStorage={requestStorage}
            onExport={exportBackup}
            onImportClick={() => importRef.current?.click()}
            dictionarySources={dictionarySources}
            onImportDictionary={importDictionary}
            onDeleteDictionary={removeDictionary}
            onCheckApi={async () => {
              try {
                const provider = settings.aiProvider;
                const ok = await checkAiApi(provider, settings.aiApiKeys[provider] || '', settings.aiModels[provider] || DEFAULT_AI_MODELS[provider]);
                setMessage(ok ? t('apiCheckOk') : t('apiCheckFailed'));
              } catch {
                setMessage(t('apiCheckFailed'));
              }
            }}
          />
        )}
      </main>

      <nav className="bottom-nav">
        <NavButton active={view === 'library'} onClick={() => setView('library')}>{t('navBooks')}</NavButton>
        <NavButton active={view === 'reader'} onClick={() => setView('reader')}>{t('navRead')}</NavButton>
        <NavButton active={view === 'vocabulary'} onClick={() => setView('vocabulary')}>{t('navWords')}</NavButton>
        <NavButton active={view === 'flashcards'} onClick={() => setView('flashcards')}>{t('navReview')}</NavButton>
        <NavButton active={view === 'settings'} onClick={() => setView('settings')}>{t('navSettings')}</NavButton>
      </nav>

      <input ref={importRef} className="hidden" type="file" accept="application/json" onChange={importBackup} />


      {aiPanel && (
        <AiPopup title={aiPanel.title} onClose={() => setAiPanel(null)} closeLabel={t('close')}>
          <p className="quote">{aiPanel.inputText}</p>
          {aiPanel.loading ? <p>{t('aiLoading')}</p> : <AiStructuredContent mode={aiPanel.mode} text={aiPanel.text} t={t} />}
          {aiPanel.cached && <p className="muted">{t('aiCached')}</p>}
        </AiPopup>
      )}
    </div>
  );
}


function speakOriginalText(text: string, language: SourceLanguage) {
  if (!text.trim() || typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return;
  }

  const langCode = language === 'fr' ? 'fr-FR' : 'en-US';
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = langCode;
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;

  const voices = window.speechSynthesis.getVoices();
  const matchingVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith(language));
  if (matchingVoice) {
    utterance.voice = matchingVoice;
  }

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function titleForView(view: ViewName, t: (key: string) => string): string {
  const map: Record<ViewName, string> = {
    library: t('libraryTitle'),
    reader: t('navRead'),
    vocabulary: t('vocabularyTitle'),
    flashcards: t('flashcardsTitle'),
    settings: t('settingsTitle')
  };
  return map[view];
}

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>{children}</button>;
}

function apiKeyPlaceholder(provider: AiProvider): string {
  if (provider === 'gemini') return 'AIza...';
  if (provider === 'openrouter') return 'sk-or-...';
  if (provider === 'mistral') return '...';
  if (provider === 'groq') return 'gsk_...';
  return 'sk-...';
}

function providerHint(provider: AiProvider, t: (key: string) => string): string {
  if (provider === 'gemini') return t('geminiHint');
  if (provider === 'groq') return t('groqHint');
  if (provider === 'openrouter') return t('openrouterHint');
  if (provider === 'mistral') return t('mistralHint');
  return t('openaiHint');
}

function LibraryView({
  t,
  settings,
  books,
  preparedBooks,
  preparedCatalogChecked,
  preparedImportingId,
  localBookIds,
  onUpload,
  onOpen,
  onDelete,
  onImportPrepared,
  onRefreshPrepared
}: {
  t: (key: string) => string;
  settings: AppSettings;
  books: BookRecord[];
  preparedBooks: PreparedBookCatalogItem[];
  preparedCatalogChecked: boolean;
  preparedImportingId: string;
  localBookIds: Set<string>;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpen: (bookId: string) => void;
  onDelete: (bookId: string) => void;
  onImportPrepared: (item: PreparedBookCatalogItem) => void;
  onRefreshPrepared: () => void;
}) {
  return (
    <div className="stack">
      <div className="card highlight-card">
        <h2>{t('continueReading')}</h2>
        <p>{t('installTip')}</p>
        <label className="upload-button">
          {t('uploadPdf')}
          <input type="file" accept="application/pdf" onChange={onUpload} />
        </label>
        <p className="muted">{t('sourceLanguage')}: {settings.defaultSourceLanguage === 'fr' ? t('french') : t('english')}</p>
      </div>

      <section className="card prepared-library-card">
        <div className="section-title-row">
          <div>
            <h2>{t('preparedLibraryTitle')}</h2>
            <p className="muted">{t('preparedLibraryHelp')}</p>
          </div>
          <Button className="button-small" onClick={onRefreshPrepared}>{t('refreshPrepared')}</Button>
        </div>

        {!preparedCatalogChecked && <p className="muted">{t('preparedLoading')}</p>}
        {preparedCatalogChecked && !preparedBooks.length && <p className="muted">{t('preparedEmpty')}</p>}

        {!!preparedBooks.length && (
          <div className="prepared-book-list">
            {preparedBooks.map((item) => {
              const isLocal = localBookIds.has(item.id);
              const isImporting = preparedImportingId === item.id;
              return (
                <article className="prepared-book-row" key={item.id}>
                  <div>
                    <h3>{item.title}</h3>
                    <p className="muted">
                      {[item.author, item.sourceLanguage === 'fr' ? t('french') : t('english'), item.level, item.pageCount ? `${item.pageCount} ${t('page').toLowerCase()}` : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {item.description && <p>{item.description}</p>}
                  </div>
                  <div className="action-row">
                    {isLocal ? (
                      <Button variant="primary" onClick={() => onOpen(item.id)}>{t('openBook')}</Button>
                    ) : (
                      <Button variant="primary" onClick={() => onImportPrepared(item)} disabled={isImporting}>
                        {isImporting ? t('preparedImportingShort') : t('downloadPrepared')}
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="section-title-row">
        <h2>{t('localLibraryTitle')}</h2>
      </div>
      {!books.length && <p className="muted">{t('emptyLibrary')}</p>}

      <div className="book-grid">
        {books.map((book) => (
          <article className="card book-card" key={book.id}>
            <div>
              <h3>{book.title}</h3>
              <p className="muted">{book.sourceLanguage === 'fr' ? t('french') : t('english')} · {book.pageCount} {t('page').toLowerCase()}</p>
            </div>
            <div className="action-row">
              <Button variant="primary" onClick={() => onOpen(book.id)}>{t('openBook')}</Button>
              <Button variant="danger" onClick={() => onDelete(book.id)}>{t('deleteBook')}</Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function ReaderView({
  t,
  book,
  page,
  currentPage,
  pageCount,
  sentenceTranslations,
  selectedWord,
  onPageChange,
  onSelectWord,
  onClearSelectedWord,
  onSaveSelectedWord,
  onExplainSentence,
  onGrammar,
  onSimplify,
  onQuiz
}: {
  t: (key: string) => string;
  book: BookRecord | null;
  page: PageTextRecord | null;
  currentPage: number;
  pageCount: number;
  sentenceTranslations: Record<string, string>;
  selectedWord: SelectedWordState | null;
  onPageChange: (page: number) => void;
  onSelectWord: (word: string, sentence: string) => void;
  onClearSelectedWord: () => void;
  onSaveSelectedWord: () => void;
  onExplainSentence: (sentence: string) => void;
  onGrammar: (sentence: string) => void;
  onSimplify: (sentence: string) => void;
  onQuiz: (sentence: string) => void;
}) {
  const [selectedSentence, setSelectedSentence] = useState<string>('');
  const sentences = useMemo(() => splitIntoSentences(page?.text || ''), [page?.text]);
  const progressPercent = pageCount ? Math.max(4, Math.round((currentPage / pageCount) * 100)) : 0;

  useEffect(() => {
    setSelectedSentence('');
  }, [page?.id]);

  if (!book) return <p className="muted">{t('readerEmpty')}</p>;

  return (
    <div className="reader-layout">
      <div className="reader-controls card compact-card page-status-card">
        <div>
          <span className="reader-page-label">{t('page')} {currentPage} {t('of')} {pageCount}</span>
          <p className="muted reader-hint">{t('tapSentenceHint')}</p>
        </div>
        <div className="page-progress" aria-hidden="true">
          <span style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <article className="reader-page-shell card">
        <button
          className="page-edge page-edge-left"
          type="button"
          aria-label={t('previous')}
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <span>‹</span>
        </button>
        <button
          className="page-edge page-edge-right"
          type="button"
          aria-label={t('next')}
          disabled={currentPage >= pageCount}
          onClick={() => onPageChange(currentPage + 1)}
        >
          <span>›</span>
        </button>

        <div className="reader-page">
          {!sentences.length && <p>{t('noTextOnPage')}</p>}
          {sentences.map((sentence, index) => {
            const isSelected = selectedSentence === sentence;
            const wordForSentence = selectedWord?.sentence === sentence ? selectedWord : null;
            return (
              <div className="sentence-block" key={`${currentPage}-${index}`}>
                <p
                  className={`sentence ${isSelected ? 'selected-sentence' : ''}`}
                  onClick={() => {
                    onClearSelectedWord();
                    setSelectedSentence(isSelected ? '' : sentence);
                  }}
                >
                  {splitSentenceIntoParts(sentence).map((part, partIndex) => {
                    if (part.type === 'word') {
                      return (
                        <button
                          key={partIndex}
                          className="word-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedSentence('');
                            onSelectWord(part.value, sentence);
                          }}
                        >
                          {part.value}
                        </button>
                      );
                    }
                    return <span key={partIndex}>{part.value}</span>;
                  })}
                </p>

                {wordForSentence && (
                  <div className="sentence-popover word-translation-popover" onClick={(event) => event.stopPropagation()}>
                    <div className="sentence-translation-box">
                      <p className="eyebrow">{wordForSentence.word} · {t('offlineTranslation')}</p>
                      {wordForSentence.loading ? (
                        <p className="sentence-translation muted">{t('uploadProcessing')}</p>
                      ) : wordForSentence.dictionaryEntry ? (
                        <p className="sentence-translation">{wordForSentence.dictionaryEntry.translationsRu.join(', ')}</p>
                      ) : (
                        <p className="sentence-translation muted">{t('dictionaryNotFound')}</p>
                      )}
                    </div>
                    <div className="sentence-action-row sentence-action-row-small word-action-row">
                      <Button className="button-small listen-button" onClick={() => speakOriginalText(wordForSentence.word, book.sourceLanguage)} aria-label={t('listenOriginal')} title={t('listenOriginal')}>
                        🔊
                      </Button>
                      <Button className="button-small" variant="primary" onClick={onSaveSelectedWord} disabled={wordForSentence.saved || !wordForSentence.dictionaryEntry}>
                        {wordForSentence.saved ? t('saved') : t('saveWord')}
                      </Button>
                    </div>
                  </div>
                )}

                {isSelected && (
                  <div className="sentence-popover" onClick={(event) => event.stopPropagation()}>
                    <div className="sentence-translation-box">
                      <p className="eyebrow">{t('cachedTranslation')}</p>
                      <p className={sentenceTranslations[sentence] ? 'sentence-translation' : 'sentence-translation muted'}>
                        {sentenceTranslations[sentence] || t('translationNotReady')}
                      </p>
                    </div>
                    <div className="sentence-action-row sentence-action-row-small">
                      <Button className="button-small listen-button" onClick={() => speakOriginalText(sentence, book.sourceLanguage)} aria-label={t('listenOriginal')} title={t('listenOriginal')}>
                        🔊
                      </Button>
                      <Button className="button-small" variant="primary" onClick={() => onExplainSentence(sentence)}>{t('explainShort')}</Button>
                      <Button className="button-small" onClick={() => onGrammar(sentence)}>{t('grammarShort')}</Button>
                      <Button className="button-small" onClick={() => onSimplify(sentence)}>{t('simplifyShort')}</Button>
                      <Button className="button-small" onClick={() => onQuiz(sentence)}>{t('quizShort')}</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </article>
    </div>
  );
}

function VocabularyView({
  t,
  words,
  onDelete,
  onMarkKnown
}: {
  t: (key: string) => string;
  words: VocabularyRecord[];
  onDelete: (id: string) => void;
  onMarkKnown: (word: VocabularyRecord) => void;
}) {
  if (!words.length) return <p className="muted">{t('emptyVocabulary')}</p>;

  return (
    <div className="stack">
      {words.map((word) => (
        <article className="card word-card" key={word.id}>
          <div>
            <div className="word-title-row">
              <h3>{word.word}</h3>
              <Button
                className="button-small listen-button word-listen-button"
                onClick={() => speakOriginalText(word.word, word.sourceLanguage)}
                aria-label={t('listenOriginal')}
                title={t('listenOriginal')}
              >
                🔊
              </Button>
            </div>
            <p>{word.translationRu || '—'}</p>
            {word.exampleSentence && <p className="quote">{word.exampleSentence}</p>}
            <span className="pill">{statusLabel(word.status, t)}</span>
          </div>
          <div className="action-row">
            <Button onClick={() => onMarkKnown(word)}>{t('markKnown')}</Button>
            <Button variant="danger" onClick={() => onDelete(word.id)}>{t('delete')}</Button>
          </div>
        </article>
      ))}
    </div>
  );
}

function statusLabel(status: VocabularyRecord['status'], t: (key: string) => string) {
  if (status === 'known') return t('statusKnown');
  if (status === 'learning') return t('statusLearning');
  return t('statusNew');
}

function FlashcardsView({
  t,
  word,
  answerVisible,
  onShowAnswer,
  onReview
}: {
  t: (key: string) => string;
  word?: VocabularyRecord;
  answerVisible: boolean;
  onShowAnswer: () => void;
  onReview: (quality: ReviewQuality) => void;
}) {
  if (!word) return <p className="muted">{t('emptyFlashcards')}</p>;

  return (
    <div className="flashcard-wrap">
      <article className="flashcard card">
        <p className="eyebrow">{word.sourceLanguage.toUpperCase()} → RU</p>
        <h2>{word.word}</h2>
        {answerVisible ? (
          <div className="stack flashcard-answer-content">
            <Button
              className="button-small listen-button flashcard-listen-button"
              onClick={() => speakOriginalText(word.word, word.sourceLanguage)}
              aria-label={t('listenOriginal')}
              title={t('listenOriginal')}
            >
              🔊 {t('listenOriginal')}
            </Button>
            <h3>{word.translationRu || '—'}</h3>
            {word.exampleSentence && <p className="quote">{word.exampleSentence}</p>}
          </div>
        ) : (
          <Button variant="primary" onClick={onShowAnswer}>{t('showAnswer')}</Button>
        )}
      </article>
      {answerVisible && (
        <div className="review-row">
          <Button onClick={() => onReview('again')}>{t('again')}</Button>
          <Button onClick={() => onReview('hard')}>{t('hard')}</Button>
          <Button variant="primary" onClick={() => onReview('good')}>{t('good')}</Button>
          <Button onClick={() => onReview('easy')}>{t('easy')}</Button>
        </div>
      )}
    </div>
  );
}

function SettingsView({
  t,
  settings,
  dictionarySources,
  onSave,
  onDeleteKey,
  onRequestStorage,
  onExport,
  onImportClick,
  onImportDictionary,
  onDeleteDictionary,
  onCheckApi
}: {
  t: (key: string) => string;
  settings: AppSettings;
  dictionarySources: DictionarySourceRecord[];
  onSave: (settings: AppSettings) => void;
  onDeleteKey: () => void;
  onRequestStorage: () => void;
  onExport: () => void;
  onImportClick: () => void;
  onImportDictionary: (file: File, language: SourceLanguage, sourceName: string) => Promise<void>;
  onDeleteDictionary: (sourceId: string) => void;
  onCheckApi: () => void;
}) {
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  return (
    <div className="stack">
      <section className="card stack">
        <Select label={t('interfaceLanguage')} value={draft.uiLanguage} onChange={(event) => setDraft({ ...draft, uiLanguage: event.target.value as UiLanguage })}>
          <option value="ru">Русский</option>
          <option value="en">English</option>
          <option value="fr">Français</option>
        </Select>
        <Select label={t('defaultBookLanguage')} value={draft.defaultSourceLanguage} onChange={(event) => setDraft({ ...draft, defaultSourceLanguage: event.target.value as SourceLanguage })}>
          <option value="fr">{t('french')}</option>
          <option value="en">{t('english')}</option>
        </Select>
        <Select label={t('quizQuestionLanguage')} value={draft.quizQuestionLanguage} onChange={(event) => setDraft({ ...draft, quizQuestionLanguage: event.target.value as AppSettings['quizQuestionLanguage'] })}>
          <option value="ru">{t('quizLanguageRussian')}</option>
          <option value="source">{t('quizLanguageSource')}</option>
        </Select>
        <Button variant="primary" onClick={() => onSave(draft)}>{t('saveSettings')}</Button>
      </section>

      <section className="card stack">
        <div>
          <h3>{t('aiSettings')}</h3>
          <p className="muted">{t('aiProviderHelp')}</p>
        </div>
        <Select label={t('aiProvider')} value={draft.aiProvider} onChange={(event) => setDraft({ ...draft, aiProvider: event.target.value as AiProvider })}>
          {AI_PROVIDERS.map((provider) => (
            <option key={provider} value={provider}>{providerName(provider)}</option>
          ))}
        </Select>
        <TextInput
          label={`${providerName(draft.aiProvider)} ${t('apiKey')}`}
          type="password"
          placeholder={apiKeyPlaceholder(draft.aiProvider)}
          value={draft.aiApiKeys[draft.aiProvider] || ''}
          onChange={(event) => setDraft({ ...draft, aiApiKeys: { ...draft.aiApiKeys, [draft.aiProvider]: event.target.value } })}
        />
        <TextInput
          label={`${providerName(draft.aiProvider)} ${t('model')}`}
          placeholder={DEFAULT_AI_MODELS[draft.aiProvider]}
          value={draft.aiModels[draft.aiProvider] || ''}
          onChange={(event) => setDraft({ ...draft, aiModels: { ...draft.aiModels, [draft.aiProvider]: event.target.value } })}
        />
        <p className="muted">{providerHint(draft.aiProvider, t)}</p>
        <p className="muted">{t('apiWarning')}</p>
        <div className="action-row">
          <Button variant="primary" onClick={() => onSave(draft)}>{t('saveSettings')}</Button>
          <Button onClick={onCheckApi}>{t('apiCheck')}</Button>
          <Button variant="danger" onClick={onDeleteKey}>{t('deleteApiKey')}</Button>
        </div>
      </section>

      <DictionarySettingsPanel
        t={t}
        sources={dictionarySources}
        defaultLanguage={settings.defaultSourceLanguage}
        onImportDictionary={onImportDictionary}
        onDeleteDictionary={onDeleteDictionary}
      />

      <section className="card stack">
        <h3>{t('persistentStorage')}</h3>
        <Button onClick={onRequestStorage}>{t('requestPersistentStorage')}</Button>
        <p className="muted">{t('exportNote')}</p>
        <div className="action-row">
          <Button onClick={onExport}>{t('exportBackup')}</Button>
          <Button onClick={onImportClick}>{t('importBackup')}</Button>
        </div>
      </section>
    </div>
  );
}



function DictionarySettingsPanel({
  t,
  sources,
  defaultLanguage,
  onImportDictionary,
  onDeleteDictionary
}: {
  t: (key: string) => string;
  sources: DictionarySourceRecord[];
  defaultLanguage: SourceLanguage;
  onImportDictionary: (file: File, language: SourceLanguage, sourceName: string) => Promise<void>;
  onDeleteDictionary: (sourceId: string) => void;
}) {
  const [language, setLanguage] = useState<SourceLanguage>(defaultLanguage);
  const [sourceName, setSourceName] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setLanguage(defaultLanguage);
  }, [defaultLanguage]);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await onImportDictionary(file, language, sourceName);
    setSourceName('');
    event.target.value = '';
  };

  const grouped = sources.reduce<Record<SourceLanguage, DictionarySourceRecord[]>>((acc, source) => {
    acc[source.language].push(source);
    return acc;
  }, { en: [], fr: [] });

  return (
    <section className="card stack dictionary-settings-card">
      <div>
        <h3>{t('offlineDictionaries')}</h3>
        <p className="muted">{t('dictionaryHelp')}</p>
      </div>

      <div className="dictionary-import-grid">
        <Select label={t('dictionaryLanguage')} value={language} onChange={(event) => setLanguage(event.target.value as SourceLanguage)}>
          <option value="fr">{t('french')} → Русский</option>
          <option value="en">{t('english')} → Русский</option>
        </Select>
        <TextInput
          label={t('dictionaryName')}
          placeholder={t('dictionaryNamePlaceholder')}
          value={sourceName}
          onChange={(event) => setSourceName(event.target.value)}
        />
      </div>

      <div className="action-row">
        <Button variant="primary" onClick={() => fileRef.current?.click()}>{t('importDictionary')}</Button>
        <a className="dictionary-link" href={`${import.meta.env.BASE_URL}dictionaries/README.txt`} target="_blank" rel="noreferrer">{t('dictionaryFormatHelp')}</a>
      </div>
      <input ref={fileRef} className="hidden" type="file" accept=".json,.csv,.tsv,.dsl,text/plain,application/json" onChange={handleFile} />

      <div className="dictionary-source-list">
        {(['fr', 'en'] as SourceLanguage[]).map((lang) => (
          <div key={lang} className="dictionary-language-group">
            <p className="eyebrow">{lang === 'fr' ? t('french') : t('english')} → RU</p>
            {!grouped[lang].length && <p className="muted">{t('noImportedDictionaries')}</p>}
            {grouped[lang].map((source) => (
              <article key={source.id} className="dictionary-source-row">
                <div>
                  <strong>{source.name}</strong>
                  <p className="muted">{source.entryCount} · {source.format.toUpperCase()}</p>
                </div>
                <Button variant="danger" onClick={() => onDeleteDictionary(source.id)}>{t('delete')}</Button>
              </article>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function AiPopup({ title, onClose, closeLabel, children }: { title: string; onClose: () => void; closeLabel: string; children: ReactNode }) {
  return (
    <div className="ai-popup-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <section className="ai-popup-card" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-header">
          <h2>{title}</h2>
          <Button variant="ghost" onClick={onClose}>{closeLabel}</Button>
        </div>
        <div className="sheet-content">{children}</div>
      </section>
    </div>
  );
}

function AiStructuredContent({ mode, text, t }: { mode: AiExplanationRecord['mode']; text: string; t: (key: string) => string }) {
  const parsed = parseJsonObject(text);
  if (!parsed) return <FallbackAiText text={text} />;

  if (mode === 'simplify') {
    return (
      <div className="ai-card-grid">
        <section className="ai-result-card ai-result-primary">
          <p className="eyebrow">{t('simplifiedVersion')}</p>
          <p>{readString(parsed.simplified) || text}</p>
        </section>
        <section className="ai-result-card">
          <p className="eyebrow">{t('cachedTranslation')}</p>
          <p>{readString(parsed.translationRu)}</p>
        </section>
      </div>
    );
  }

  if (mode === 'quiz') {
    const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
    return <QuizCards cards={cards} t={t} fallback={text} />;
  }

  if (mode === 'grammar') {
    return (
      <div className="ai-card-grid">
        <section className="ai-result-card ai-result-primary">
          <p className="eyebrow">{t('grammarFocus')}</p>
          <p>{readString(parsed.construction)}</p>
        </section>
        <section className="ai-result-card">
          <p className="eyebrow">{t('meaning')}</p>
          <p>{readString(parsed.meaningRu)}</p>
        </section>
        {readString(parsed.example) && (
          <section className="ai-result-card">
            <p className="eyebrow">{t('example')}</p>
            <p>{readString(parsed.example)}</p>
          </section>
        )}
      </div>
    );
  }

  if (mode === 'sentence') {
    const keywords = Array.isArray(parsed.keyWords) ? parsed.keyWords.slice(0, 3) : [];
    return (
      <div className="ai-card-grid">
        <section className="ai-result-card ai-result-primary">
          <p className="eyebrow">{t('cachedTranslation')}</p>
          <p>{readString(parsed.translationRu)}</p>
        </section>
        <section className="ai-result-card">
          <p className="eyebrow">{t('mainPoint')}</p>
          <p>{readString(parsed.mainIdeaRu)}</p>
        </section>
        {!!keywords.length && (
          <section className="ai-result-card">
            <p className="eyebrow">{t('keyWords')}</p>
            <div className="keyword-chips">
              {keywords.map((item: any, index: number) => (
                <span className="keyword-chip" key={index}>
                  <strong>{readString(item.word)}</strong> {readString(item.meaningRu)}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  if (mode === 'word') {
    return (
      <div className="ai-card-grid">
        <section className="ai-result-card ai-result-primary">
          <p className="eyebrow">{t('offlineTranslation')}</p>
          <p>{readString(parsed.translationRu)}</p>
        </section>
      </div>
    );
  }

  return <FallbackAiText text={text} />;
}

function QuizCards({ cards, t, fallback }: { cards: any[]; t: (key: string) => string; fallback: string }) {
  const [openIndexes, setOpenIndexes] = useState<Set<number>>(new Set());
  if (!cards.length) return <FallbackAiText text={fallback} />;

  const toggle = (index: number) => {
    setOpenIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className="quiz-card-grid">
      {cards.map((card, index) => {
        const isOpen = openIndexes.has(index);
        return (
          <button className={`quiz-card ${isOpen ? 'quiz-card-open' : ''}`} key={index} onClick={() => toggle(index)} type="button">
            <span className="eyebrow">{isOpen ? t('answer') : t('question')} {index + 1}</span>
            <strong>{isOpen ? readString(card.answer) : readString(card.question)}</strong>
            <small>{isOpen ? t('tapForQuestion') : t('tapForAnswer')}</small>
          </button>
        );
      })}
    </div>
  );
}

function FallbackAiText({ text }: { text: string }) {
  return (
    <div className="ai-text">
      {text.split('\n').filter(Boolean).map((line, index) => (
        <p key={index}>{line}</p>
      ))}
    </div>
  );
}

function parseJsonObject(text: string): any | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function readString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  return String(value).trim();
}
