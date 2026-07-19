import * as db from './db.js'
import { extractMeta, cfiOf, textOf, noteOf } from './lib.js'
import { applyTheme, wireThemeToggle, setPreset, setCustomCSS, clearCustomCSS, getTheme } from './theme.js'

const $ = s => document.querySelector(s)
const esc = s => (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
let coverURLs = []

applyTheme(); wireThemeToggle()

// ---------- adding books ----------
async function addFiles(fileList) {
  const files = [...fileList].filter(f => /\.epub$/i.test(f.name) || f.type === 'application/epub+zip')
  if (!files.length) { toast('Bitte EPUB-Dateien wählen.'); return }
  for (const f of files) {
    try {
      toast(`Lese „${f.name}"…`)
      const existingId = await db.hashFile(f)
      if (await db.getBook(existingId)) { toast(`„${f.name}" ist schon da.`); continue }
      const { meta, coverBlob } = await extractMeta(f)
      await db.saveBook(meta, f, coverBlob)
    } catch (e) { console.error(e); toast(`Fehler bei „${f.name}".`) }
  }
  toast('')
  render()
}

$('#file-input').addEventListener('change', e => addFiles(e.target.files))

// drag & drop
const dropHint = $('#drop-hint')
window.addEventListener('dragover', e => { e.preventDefault(); dropHint.classList.add('show') })
window.addEventListener('dragleave', e => { if (e.relatedTarget === null) dropHint.classList.remove('show') })
window.addEventListener('drop', e => {
  e.preventDefault(); dropHint.classList.remove('show')
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
})

// ---------- rendering ----------
$('#search').addEventListener('input', render)
$('#sort').addEventListener('change', render)

function sortBooks(books, sort) {
  const by = {
    title: (a, b) => (a.title || '').localeCompare(b.title || ''),
    author: (a, b) => (a.authors?.[0] || '').localeCompare(b.authors?.[0] || ''),
    added: (a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''),
    recent: (a, b) => (b.lastReadAt || '').localeCompare(a.lastReadAt || '') || (b.addedAt || '').localeCompare(a.addedAt || ''),
  }
  return books.sort(by[sort] || by.recent)
}

async function render() {
  coverURLs.forEach(URL.revokeObjectURL); coverURLs = []
  const q = $('#search').value.trim().toLowerCase()
  let books = await db.listBooks()
  if (q) books = books.filter(b => (b.title + ' ' + (b.authors || []).join(' ') + ' ' + b.series).toLowerCase().includes(q))
  books = sortBooks(books, $('#sort').value)

  $('#toolbar').hidden = (await db.listBooks()).length === 0
  $('#empty').hidden = books.length !== 0
  $('#count').textContent = books.length ? `${books.length} ${books.length === 1 ? 'Buch' : 'Bücher'}` : ''

  const grid = $('#grid'); grid.innerHTML = ''
  for (const b of books) {
    const cell = document.createElement('div'); cell.className = 'book-cell'
    const a = document.createElement('a'); a.className = 'book-cover-link'; a.href = `/reader.html?id=${b.id}`
    a.title = `Lesen: ${b.title}`
    const img = document.createElement('img'); img.className = 'book-cover'; img.loading = 'lazy'; img.alt = b.title
    const cover = await db.getCoverBlob(b.id)
    if (cover) { const u = URL.createObjectURL(cover); coverURLs.push(u); img.src = u } else img.src = '/placeholder-cover.svg'
    a.append(img)
    if (b.progress > 0.001) { const pb = document.createElement('span'); pb.className = 'progress-bar'; pb.innerHTML = `<span style="width:${(b.progress * 100).toFixed(1)}%"></span>`; a.append(pb) }
    cell.append(a)
    const t = document.createElement('button'); t.className = 'book-title-btn'; t.textContent = b.title
    t.addEventListener('click', () => openBookModal(b.id))
    const au = document.createElement('div'); au.className = 'book-author'; au.textContent = (b.authors || []).join(', ')
    cell.append(t, au)
    grid.append(cell)
  }
}

// ---------- book detail modal ----------
async function openBookModal(id) {
  const b = await db.getBook(id)
  if (!b) return
  const page = await db.getAnnotations(id)
  const items = page.items || []
  const notesHtml = items.length ? items.map(a => `
    <li class="anno-item" style="--anno-color:${esc(a.color || 'transparent')}">
      <div class="anno-quote">${a.motivation === 'bookmarking' ? '🔖 Lesezeichen' : esc(textOf(a) || '(markierte Stelle)')}</div>
      ${noteOf(a) ? `<div class="anno-note">${esc(noteOf(a))}</div>` : ''}
    </li>`).join('') : '<p class="muted small">Noch keine Notizen.</p>'

  const card = $('#book-modal-card')
  card.innerHTML = `
    <div class="detail-head">
      <img class="detail-cover" id="d-cover" alt="">
      <div>
        <h2 id="d-title">${esc(b.title)}</h2>
        <p class="muted" id="d-author">${esc((b.authors || []).join(', '))}</p>
        <div class="detail-actions">
          <a class="btn btn-primary" href="/reader.html?id=${b.id}">${b.progress > 0.001 ? 'Weiterlesen' : 'Lesen'}</a>
          <button class="btn btn-sm" id="d-download">EPUB ⭳</button>
          <button class="btn btn-sm btn-danger" id="d-delete">Löschen</button>
        </div>
      </div>
    </div>
    <details class="mt"><summary>Metadaten bearbeiten</summary>
      <div class="editor-tools"><button class="btn btn-sm" id="d-autofill">Automatisch füllen</button><span class="muted small" id="d-af-status"></span></div>
      <div class="form-group"><label>Titel</label><input id="f-title" value="${esc(b.title)}"></div>
      <div class="form-group"><label>Autor(en), mit ; trennen</label><input id="f-authors" value="${esc((b.authors || []).join('; '))}"></div>
      <div class="form-row"><div class="form-group"><label>Verlag</label><input id="f-publisher" value="${esc(b.publisher)}"></div>
        <div class="form-group"><label>Jahr</label><input id="f-published" value="${esc(b.published)}"></div></div>
      <div class="form-row"><div class="form-group"><label>Sprache</label><input id="f-language" value="${esc(b.language)}"></div>
        <div class="form-group"><label>ISBN</label><input id="f-isbn" value="${esc(b.isbn)}"></div></div>
      <button class="btn btn-sm btn-primary" id="d-save">Speichern</button>
    </details>
    <div class="notebook-head mt"><h3>Notizbuch <span class="muted">· ${items.length}</span></h3>
      ${items.length ? `<span class="export-links"><span class="muted small">Export:</span>
        <a href="#" id="exp-md">Markdown</a> <a href="#" id="exp-html">HTML</a></span>` : ''}</div>
    <ul class="anno-list">${notesHtml}</ul>
    <button class="btn btn-sm modal-close" data-close>Schließen</button>`

  const cover = await db.getCoverBlob(id)
  if (cover) { const u = URL.createObjectURL(cover); coverURLs.push(u); $('#d-cover').src = u } else $('#d-cover').src = '/placeholder-cover.svg'

  $('#d-download').addEventListener('click', async () => {
    const blob = await db.getFileBlob(id); if (blob) downloadBlob(blob, (b.fileName || b.title + '.epub'))
  })
  $('#d-delete').addEventListener('click', async () => {
    if (confirm('Buch aus dem Browser löschen? EPUB und Notizen werden entfernt.')) { await db.deleteBook(id); closeModals(); render() }
  })
  $('#d-save').addEventListener('click', async () => {
    b.title = $('#f-title').value.trim() || b.title
    b.authors = $('#f-authors').value.split(';').map(s => s.trim()).filter(Boolean)
    b.publisher = $('#f-publisher').value.trim(); b.published = $('#f-published').value.trim()
    b.language = $('#f-language').value.trim(); b.isbn = $('#f-isbn').value.trim()
    await db.put('books', b); toast('Gespeichert.'); render(); openBookModal(id)
  })
  $('#d-autofill')?.addEventListener('click', () => autofill(b))
  $('#exp-md')?.addEventListener('click', e => { e.preventDefault(); downloadText(notebookMarkdown(b, items), `${slug(b.title)}.md`, 'text/markdown') })
  $('#exp-html')?.addEventListener('click', e => { e.preventDefault(); downloadText(notebookHTML(b, items), `${slug(b.title)}.html`, 'text/html') })

  show('#book-modal')
}

// ---------- metadata autofill (client-side, CORS-friendly APIs) ----------
async function autofill(b) {
  const st = $('#d-af-status'); st.textContent = 'Suche…'
  try {
    let d = null
    const isbn = (b.isbn || '').replace(/[^0-9Xx]/g, '')
    if (isbn) {
      const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`)
      const j = await r.json(); d = pickGoogle(j)
    }
    if (!d) {
      const q = encodeURIComponent([b.title, b.authors?.[0]].filter(Boolean).join(' '))
      const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1`)
      d = pickGoogle(await r.json())
    }
    if (!d) { st.textContent = 'Nichts gefunden.'; return }
    if (d.title && !$('#f-title').value) $('#f-title').value = d.title
    if (d.authors?.length && !$('#f-authors').value) $('#f-authors').value = d.authors.join('; ')
    if (d.publisher) $('#f-publisher').value ||= d.publisher
    if (d.published) $('#f-published').value ||= d.published
    if (d.language) $('#f-language').value ||= d.language
    if (d.isbn) $('#f-isbn').value ||= d.isbn
    st.textContent = 'Vorschlag von Google Books — prüfen und speichern.'
  } catch (e) { st.textContent = 'Fehler beim Abruf.' }
}
function pickGoogle(j) {
  const v = j.items?.[0]?.volumeInfo; if (!v) return null
  const ids = {}; (v.industryIdentifiers || []).forEach(i => ids[i.type] = i.identifier)
  return { title: v.title + (v.subtitle ? `: ${v.subtitle}` : ''), authors: v.authors || [], publisher: v.publisher || '', published: v.publishedDate || '', language: v.language || '', isbn: ids.ISBN_13 || ids.ISBN_10 || '' }
}

// ---------- notebook export ----------
function cfiKey(c) { return (c.match(/\d+/g) || []).map(Number) }
function sortNotes(items) { return [...items].sort((a, b) => { const x = cfiKey(cfiOf(a)), y = cfiKey(cfiOf(b)); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0) } return 0 }) }
function notebookMarkdown(b, items) {
  const L = [`# ${b.title}`, '', b.authors?.length ? `*${b.authors.join(', ')}*\n` : '']
  for (const a of sortNotes(items)) {
    if (a.motivation === 'bookmarking') { L.push('- 🔖 **Lesezeichen**\n'); continue }
    if (textOf(a)) L.push('> ' + textOf(a).replace(/\n/g, '\n> '))
    if (noteOf(a)) L.push('', noteOf(a))
    L.push('')
  }
  return L.join('\n') + '\n'
}
function notebookHTML(b, items) {
  const body = sortNotes(items).map(a => a.motivation === 'bookmarking'
    ? '<div class="bm">🔖 Lesezeichen</div>'
    : `<div class="hl" style="--c:${esc(a.color || '#4a7a3f')}">${textOf(a) ? `<div class="q">${esc(textOf(a))}</div>` : ''}${noteOf(a) ? `<div class="n">${esc(noteOf(a))}</div>` : ''}</div>`).join('\n')
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Notizen — ${esc(b.title)}</title>
<style>body{font-family:-apple-system,Inter,sans-serif;max-width:720px;margin:0 auto;padding:3rem 1.4rem;line-height:1.6;color:#3d4a3f}
h1{font-family:monospace}.author{color:#7a8b7e}.hl{border-left:3px solid var(--c,#4a7a3f);padding:.3rem 0 .3rem 1rem;margin:1.1rem 0}
.q{font-style:italic}.n{color:#7a8b7e;font-size:.92rem;margin-top:.4rem}.bm{color:#4a7a3f;margin:.8rem 0}</style></head>
<body><h1>${esc(b.title)}</h1><p class="author">${esc((b.authors || []).join(', '))}</p>${body}</body></html>`
}

// ---------- settings ----------
$('#btn-settings').addEventListener('click', async () => {
  const t = getTheme()
  document.querySelectorAll('#theme-picker input').forEach(r => r.checked = r.value === (t.preset || 'weltsein'))
  $('#custom-css').value = t.css || ''
  const u = await db.usage()
  if (u.usage) $('#storage-usage').textContent = `Belegt: ${(u.usage / 1048576).toFixed(1)} MB${u.quota ? ` von ~${(u.quota / 1048576).toFixed(0)} MB` : ''}`
  show('#settings-modal')
})
document.querySelectorAll('#theme-picker input').forEach(r => r.addEventListener('change', () => setPreset(r.value)))
$('#apply-css').addEventListener('click', () => { setCustomCSS($('#custom-css').value); toast('Thema angewendet.') })
$('#clear-css').addEventListener('click', () => { $('#custom-css').value = ''; clearCustomCSS() })

$('#export-data').addEventListener('click', async () => {
  const data = { app: 'lieslese', exportedAt: new Date().toISOString(),
    books: await db.getAll('books'), locators: await db.getAll('locators'), annotations: await db.getAll('annotations') }
  downloadText(JSON.stringify(data, null, 2), 'lieslese-lesedaten.json', 'application/json')
})
$('#import-data').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return
  try {
    const d = JSON.parse(await f.text())
    for (const b of d.books || []) await db.put('books', b)
    for (const l of d.locators || []) await db.put('locators', l)
    for (const a of d.annotations || []) await db.put('annotations', a)
    toast('Lesedaten importiert (ohne EPUB-Dateien).'); render()
  } catch { toast('Import fehlgeschlagen.') }
})

// ---------- modals & misc ----------
$('#about-link').addEventListener('click', e => { e.preventDefault(); show('#about-modal') })
$('#gh-link').addEventListener('click', e => { /* set your repo URL */ })
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m || e.target.hasAttribute('data-close')) closeModals() }))
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals() })
function show(sel) { $(sel).hidden = false }
function closeModals() { document.querySelectorAll('.modal').forEach(m => m.hidden = true) }

function downloadBlob(blob, name) { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000) }
function downloadText(text, name, type) { downloadBlob(new Blob([text], { type }), name) }
function slug(s) { return (s || 'notizen').toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'notizen' }

let toastTimer
function toast(msg) {
  let el = $('#toast')
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.append(el) }
  el.textContent = msg; el.classList.toggle('show', !!msg)
  clearTimeout(toastTimer); if (msg) toastTimer = setTimeout(() => el.classList.remove('show'), 2500)
}

render()
