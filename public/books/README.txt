Prepared books library
======================

Add prepared books under public/books and list them in public/books/catalog.json.
The app will show these books in the Books screen and import them into the user's local browser storage.

Required structure:

public/books/catalog.json
public/books/my-book/book.json
public/books/my-book/translations.ru.json
public/books/my-book/dictionary.json

catalog.json example:
{
  "books": [
    {
      "id": "my-book",
      "title": "My Book",
      "author": "Author Name",
      "sourceLanguage": "fr",
      "level": "A2-B1",
      "description": "Optional short description",
      "folder": "books/my-book",
      "bookFile": "book.json",
      "translationsFile": "translations.ru.json",
      "dictionaryFile": "dictionary.json"
    }
  ]
}

book.json example:
{
  "id": "my-book",
  "title": "My Book",
  "sourceLanguage": "fr",
  "pages": [
    {
      "pageNumber": 1,
      "sentences": [
        { "id": "p1-s1", "text": "Bonjour tout le monde." },
        { "id": "p1-s2", "text": "Je suis ici." }
      ]
    }
  ]
}

translations.ru.json example:
{
  "bookId": "my-book",
  "translations": {
    "p1-s1": "Всем привет.",
    "p1-s2": "Я здесь."
  }
}

dictionary.json example:
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

Notes:
- The user can still upload their own PDFs.
- Prepared books skip client-side AI generation and import existing translations immediately.
- The app stores imported prepared books locally for offline reading after first download.
