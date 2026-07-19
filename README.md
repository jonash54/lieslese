# lieslese

A private EPUB reader that runs **entirely in your browser**. Open your own
books — they never leave your device. No account, no upload, no server-side
storage, no tracking.

[Live instance → lieslese.de](https://lieslese.de) ·
[Source → github.com/jonash54/lieslese](https://github.com/jonash54/lieslese) · MIT

## Why

Most "cloud" readers ship your library and reading data to someone else's
server. lieslese flips that: the server only delivers a static web app, and
**everything** — the EPUB files, your reading position, highlights, notes and
settings — is stored locally in your browser (IndexedDB / localStorage).

Reading data is kept in **open standard formats** so it stays portable:

- reading position → EPUB-CFI in a **Readium Locator**
- highlights / notes / bookmarks → **W3C Web Annotation**
- book metadata → parsed from the EPUB's OPF / Dublin Core

Export your notebook to Markdown/HTML anytime, or export all reading data as
JSON. Nothing is locked in.

## Features

- Open EPUBs by file picker or drag & drop; library grid with covers
- In-browser reader (foliate-js): three flow modes — paginated, continuous
  scroll, and scroll-per-chapter — plus table of contents and in-book search
- Highlights, notes, bookmarks; per-book notebook with Markdown/HTML export
- Reading settings: light / sepia / dark, font, size, line height, margins
- Metadata editor with optional autofill (Google Books, client-side)
- Accent themes (weltsein green / blue / your own CSS)
- Installable **PWA**, works fully **offline**

## Run it

```bash
docker compose up -d --build      # serves on 127.0.0.1:4585
```

Put a TLS-terminating reverse proxy (nginx, Caddy, Traefik) in front for a
public deployment. The app is a pile of static files under `public/` — you can
also serve that directory with any static web server; no backend required.

## Develop

Edit files under `public/` — with the bundled `docker-compose.yml` they are
bind-mounted, so changes are live on reload. Structure:

```
public/
  index.html        library + shell
  reader.html       the reader
  js/db.js          IndexedDB storage layer
  js/lib.js         metadata extraction + standard annotation objects
  js/library.js     library page
  js/reader.js      foliate integration + local persistence
  js/theme.js       theming
  css/              weltsein design system + app/reader styles
  vendor/foliate-js reader engine (MIT)
```

## Privacy

The server logs standard access logs only and stores nothing about you or your
books. There are no accounts and no analytics. Clearing your browser data
deletes your library — use **Settings → export** to back up.

## License

MIT. Bundles [foliate-js](https://github.com/johnfactotum/foliate-js) (MIT).
