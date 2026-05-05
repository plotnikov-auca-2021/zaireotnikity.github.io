# Читатель — local-first PWA for language reading

A Russian-first browser app for reading English/French PDF books with EWA-style learning tools.

## What is included

- Russian UI by default
- Interface language switcher: Russian / English / French
- PDF upload and text extraction with PDF.js
- Local book library in IndexedDB
- Last book/page restore after reopening the browser/app
- Offline starter dictionaries: English → Russian, French → Russian
- Tap word → offline dictionary popup
- Save words to vocabulary
- Flashcard review with a simple spaced-repetition schedule
- Browser-only AI provider selector: OpenAI, Google Gemini, Groq, OpenRouter and Mistral AI
- Tap sentence → AI explanation in Russian
- Grammar, simplify and quiz buttons
- Local AI response cache
- Export/import backup without exporting AI API keys
- PWA manifest and service worker

## Important security note

This is intentionally a pure browser-only implementation. The selected AI provider API keys are saved in this device's browser storage. This is convenient for a trusted one-person app, but it is not suitable for a public product because browser-stored keys can be inspected by the user/device owner.

The backup export intentionally removes all AI API keys.

## Quick start

```bash
npm install
npm run dev
```

Open the URL shown by Vite, usually:

```text
http://localhost:5173
```

For iPhone testing on the same Wi-Fi network, run the dev server and open the local network URL printed by Vite, for example:

```text
http://192.168.1.50:5173
```

Then in Safari:

```text
Share → Add to Home Screen
```

## Production build

```bash
npm run build
npm run preview
```

The static build is created in `dist/`.

## First user flow

1. Open the app.
2. Go to Settings.
3. Select an AI provider: OpenAI, Gemini, Groq, OpenRouter or Mistral.
4. Paste the API key for that provider.
5. Check or change model name.
6. Set default book language: French or English.
7. Go to Books.
8. Upload a PDF.
9. Open the book.
10. Tap a word for offline dictionary lookup.
11. Tap a sentence for AI explanation.
12. Save words and review flashcards.

## AI provider settings

Default models are editable in Settings:

```text
OpenAI:     gpt-4.1-mini
Gemini:     gemini-2.5-flash
Groq:       llama-3.3-70b-versatile
OpenRouter: openrouter/auto
Mistral AI: mistral-small-latest
```

If your API account does not have access to a default model, change it in Settings to a model available for your account. For OpenRouter free models, enter the exact model ID from OpenRouter, often ending with `:free` when available.

## Offline dictionaries

Starter dictionaries live here:

```text
public/dictionaries/en-ru/
public/dictionaries/fr-ru/
```

They are split by first letter:

```text
a.json
b.json
c.json
...
```

Each file is a JSON object:

```json
{
  "word": {
    "source": "word",
    "normalized": "word",
    "language": "en",
    "translationsRu": ["слово"],
    "partOfSpeech": "noun"
  }
}
```

To expand the dictionary, add more entries to these JSON chunks or create a converter script for FreeDict/Wiktionary-derived data.

## Current limitations

- Works best with text-based PDFs.
- Scanned PDFs/images need OCR, which is not implemented yet.
- Offline dictionaries are small starter dictionaries, not full dictionaries.
- Sentence translation/explanation requires internet unless already cached.
- Data is local to the browser/device. Use Export/Import for backup.
- iOS browser storage is convenient but should not be treated like a permanent server database.

## Project structure

```text
ewa-reader/
├── public/
│   ├── dictionaries/
│   ├── icons/
│   ├── manifest.webmanifest
│   └── sw.js
├── src/
│   ├── app/
│   │   └── App.tsx
│   ├── components/
│   ├── features/
│   │   ├── dictionary/
│   │   ├── flashcards/
│   │   ├── openai/
│   │   └── pdf/
│   ├── i18n/
│   ├── storage/
│   ├── styles/
│   └── utils/
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## Next recommended improvements

1. Add full dictionary import pipeline.
2. Add OCR fallback for scanned PDFs.
3. Add audio/pronunciation.
4. Add paragraph mode.
5. Add better mobile text selection.
6. Add cloud sync only if needed later.

## Offline dictionary import

This version includes a dictionary manager in **Settings → Offline dictionaries**.

Supported import formats:

- CSV / TSV: `word,translation,partOfSpeech`
- JSON object: `{ "hello": "привет" }`
- JSON array: `[{ "word": "hello", "translationsRu": ["привет"] }]`
- Basic DSL / Lingvo-style plain text where the headword is on a non-indented line and the translation is on following indented lines.

Imported dictionaries are stored in IndexedDB and are searched before the bundled mini dictionary and before OpenAI. This means word lookup can work offline after a dictionary is imported.

Suggested legal/open sources:

- FreeDict EN-RU / FR-RU dictionaries via FreeDict or Debian packages.
- Wiktionary-derived data through Kaikki/Wiktextract, if you convert it into JSON/CSV.

Do not extract dictionaries from APK/iOS apps unless the dictionary data is licensed for reuse.


## GitHub Pages deployment

This version is ready for GitHub Pages. It includes:

- `base: './'` in `vite.config.ts`, so the app works from a repository URL such as `https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/`.
- `.github/workflows/deploy.yml`, which builds the app and publishes `dist/` to GitHub Pages.
- relative manifest, icon, dictionary and service worker paths.
- a GitHub Pages workflow that installs dependencies, builds the Vite app, and deploys `dist/`.

### Steps

1. Upload or push this project folder to your GitHub repository.
2. In GitHub, open **Settings → Pages**.
3. Under **Build and deployment**, choose **GitHub Actions**.
4. Push to the `main` branch. The workflow uses `npm install`, so `package-lock.json` is intentionally not included in this ZIP.
5. Wait for the **Deploy to GitHub Pages** action to finish.
6. Open the Pages URL on iPhone Safari and use **Share → Add to Home Screen**.

Do not commit API keys. The app stores provider keys locally in the user's browser settings.
