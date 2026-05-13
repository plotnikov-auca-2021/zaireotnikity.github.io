# EWA Reader Local PWA

Russian-first PWA for reading French/English PDF books with offline dictionaries and optional browser-only AI assistance.

## Run locally

```bash
npm install
npm run dev
```

Open the URL shown by Vite. For phone testing on the same Wi-Fi, use the Network URL.

## GitHub Pages

The repository includes `.github/workflows/deploy.yml`. Push the files to `main`, then set:

`Settings → Pages → Source: GitHub Actions`

The app uses `base: './'` so it can run from a GitHub Pages repository subfolder.

## New in this version

- Whole-book sentence translation still runs on upload when an AI provider is configured.
- After each page is translated, the app collects words that are not found in the offline dictionary.
- Unknown words are batched per page and sent to the selected AI provider in one request.
- The AI response is saved into the local dictionary table with:
  - original word form
  - lemma / dictionary form
  - Russian translation
  - grammar note
  - part of speech
- Later taps on those words use the saved local AI dictionary result and do not call AI again.

## Recommended workflow

1. Import a full FR-RU or EN-RU offline dictionary in Settings.
2. Configure an AI provider and API key.
3. Upload a PDF.
4. Wait for sentence translation and AI dictionary enrichment to finish.
5. Read offline with cached translations and saved word explanations.

## Privacy

API keys are stored only in the browser on the user's device. Backup export removes API keys.

## v8 update: global local AI dictionary

AI-generated dictionary entries are now stored in one shared local dictionary per language:

- `AI learned dictionary · French → Russian`
- `AI learned dictionary · English → Russian`

When a later book contains a word form already learned from an earlier book, the app finds it locally and skips a new AI lookup. Existing old book-specific AI dictionaries are migrated into the new global learned dictionary on app startup.

## GitHub Actions build note

This package intentionally does not include `package-lock.json`. The deployment workflow installs dependencies from the public npm registry with `--no-package-lock` so GitHub Actions does not try to use a local or private registry URL from another machine.

If deployment fails at `npm install`, check that `.npmrc` is present and that no `package-lock.json` was committed.

## Prepared books

This version supports pre-prepared books so the reader does not need to run heavy AI translation on the phone.

Add files under `public/books/` and list each book in `public/books/catalog.json`.

Minimal structure:

```text
public/books/catalog.json
public/books/my-book/book.json
public/books/my-book/translations.ru.json
public/books/my-book/dictionary.json
```

`catalog.json`:

```json
{
  "books": [
    {
      "id": "my-book",
      "title": "My Book",
      "author": "Author Name",
      "sourceLanguage": "fr",
      "level": "A2-B1",
      "description": "Optional description",
      "folder": "books/my-book"
    }
  ]
}
```

`book.json`:

```json
{
  "id": "my-book",
  "title": "My Book",
  "sourceLanguage": "fr",
  "pages": [
    {
      "pageNumber": 1,
      "sentences": [
        { "id": "p1-s1", "text": "Bonjour tout le monde." }
      ]
    }
  ]
}
```

`translations.ru.json`:

```json
{
  "bookId": "my-book",
  "translations": {
    "p1-s1": "Всем привет."
  }
}
```

`dictionary.json`:

```json
{
  "bookId": "my-book",
  "entries": [
    {
      "word": "Bonjour",
      "lemma": "bonjour",
      "translationRu": "здравствуйте / привет",
      "grammar": "greeting"
    }
  ]
}
```

The app still supports user-uploaded PDFs. Prepared books are an additional path for fast reading.
