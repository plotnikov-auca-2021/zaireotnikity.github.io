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
