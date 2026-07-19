import '../vendor/foliate-js/view.js'
import { Overlayer } from '../vendor/foliate-js/overlayer.js'
import * as db from './db.js'
import { makeAnnotation, makeLocator, cfiOf, textOf, noteOf } from './lib.js'

const $ = s => document.querySelector(s)
const body = document.body
const bookId = new URLSearchParams(location.search).get('id')

// apply saved custom theme css
try { const t = JSON.parse(localStorage.getItem('lieslese-theme') || '{}'); if (t.css) $('#custom-theme').textContent = t.css } catch (e) {}

const DEFAULT_STYLE = { theme: 'light', flow: 'paginated', fontSize: 100, spacing: 1.5, margin: 6, fontFamily: '', justify: true, hyphenate: true, bottomBar: true }
const style = { ...DEFAULT_STYLE, ...loadStyle() }
function loadStyle() { try { return JSON.parse(localStorage.getItem('lieslese-style') || '{}') } catch { return {} } }
function saveStyle() { localStorage.setItem('lieslese-style', JSON.stringify(style)) }

const THEME_COLORS = {
  light: { bg: '#faf9f7', fg: '#3d4a3f', link: '#4a7a3f' },
  sepia: { bg: '#f4ecd8', fg: '#5b4636', link: '#8a5a2b' },
  dark: { bg: '#16171a', fg: '#c9ccd1', link: '#8fb0c2' },
}
function contentCSS() {
  const c = THEME_COLORS[style.theme] || THEME_COLORS.light
  const ff = style.fontFamily ? `body,p,div,span,li,h1,h2,h3,h4{font-family:${style.fontFamily} !important}` : ''
  return `@namespace epub "http://www.idpf.org/2007/ops";
    html{color-scheme:${style.theme === 'dark' ? 'dark' : 'light'};font-size:${style.fontSize}%}
    html,body{color:${c.fg} !important;background:${c.bg} !important}
    a,a:link{color:${c.link} !important}
    p,li,blockquote,dd{line-height:${style.spacing};text-align:${style.justify ? 'justify' : 'start'};hyphens:${style.hyphenate ? 'auto' : 'manual'};-webkit-hyphens:${style.hyphenate ? 'auto' : 'manual'}}
    [align="left"]{text-align:left}[align="right"]{text-align:right}[align="center"]{text-align:center}
    pre{white-space:pre-wrap !important}${ff}`
}

let view, annoPage = db.emptyAnnoPage()

// ---- navigation (three flow modes) ----
function goNext() { if (style.flow === 'chapter') view.renderer?.nextSection?.(); else view.goRight() }
function goPrev() { if (style.flow === 'chapter') view.renderer?.prevSection?.(); else view.goLeft() }
function toggleImmersive(on) { on === undefined ? body.classList.toggle('immersive') : body.classList.toggle('immersive', on) }
// tap by POSITION. Upper strip always toggles the chrome (so bars come back in
// fullscreen mode). Scroll mode: any tap only toggles the bars.
function handleTap(x, y, w, h) {
  w = w || window.innerWidth; h = h || window.innerHeight
  if (y / h < 0.15) { toggleImmersive(); return }   // ONLY the upper strip toggles the bars
  if (style.flow === 'scrolled') return             // scroll: no page turn; centre does nothing
  const f = x / w
  if (f < 0.4) goPrev(); else if (f > 0.6) goNext()
  // centre: nothing
}
let _lastScrollAt = 0, _sectionLock = false
function markScroll() { _lastScrollAt = performance.now() }
function onContentWheel(ev) {
  if (style.flow !== 'scrolled' || _sectionLock) return
  const dir = ev.deltaY > 0 ? 1 : (ev.deltaY < 0 ? -1 : 0); if (!dir) return
  const before = _lastScrollAt
  setTimeout(() => {
    if (_sectionLock || _lastScrollAt !== before) return
    const r = view.renderer; if (!r) return
    _sectionLock = true
    Promise.resolve(dir > 0 ? r.nextSection?.() : r.prevSection?.()).finally(() => setTimeout(() => { _sectionLock = false }, 400))
  }, 140)
}

function applyStyle() {
  body.dataset.rtheme = style.theme; body.dataset.flow = style.flow
  body.classList.toggle('no-bottombar', !style.bottomBar)
  const c = THEME_COLORS[style.theme] || THEME_COLORS.light
  $('#reader-view').style.background = c.bg
  if (!view || !view.renderer) return
  view.renderer.setStyles?.(contentCSS())
  view.renderer.setAttribute('flow', style.flow === 'paginated' ? 'paginated' : 'scrolled')
  view.renderer.setAttribute('margin', `${20 + style.margin * 6}px`)
  view.renderer.setAttribute('gap', '6%')
  view.renderer.setAttribute('max-inline-size', `${960 - style.margin * 42}px`)
  syncAppearanceUI()
}

// ---- annotations (Web Annotation in IndexedDB) ----
const annById = new Map(), annByValue = new Map(), annByIndex = new Map()
function indexOfCFI(cfi) { try { return view.resolveNavigation(cfi)?.index ?? null } catch { return null } }
function recOf(a) { return { id: a.id, cfi: cfiOf(a), text: textOf(a), note: noteOf(a), color: a.color || '#ffd54a', motivation: a.motivation || 'highlighting' } }
function register(rec) { annById.set(rec.id, rec); annByValue.set(rec.cfi, rec); const i = indexOfCFI(rec.cfi); if (i != null) { if (!annByIndex.has(i)) annByIndex.set(i, new Set()); annByIndex.get(i).add(rec) } return rec }
function unregister(rec) { annById.delete(rec.id); annByValue.delete(rec.cfi); annByIndex.get(indexOfCFI(rec.cfi))?.delete(rec) }

async function persistAnnotations() { await db.saveAnnotations(bookId, annoPage) }
async function loadAnnotations() { annoPage = await db.getAnnotations(bookId); for (const a of (annoPage.items || [])) register(recOf(a)); renderAnnoPanel() }

function drawRec(draw, rec) { const color = rec.color || '#ffd54a'; if (rec.motivation === 'bookmarking') draw(Overlayer.underline, { color, width: 3 }); else draw(Overlayer.highlight, { color }) }
function wireAnnotationEvents() {
  view.addEventListener('create-overlay', e => { const l = annByIndex.get(e.detail.index); if (l) for (const r of l) view.addAnnotation({ value: r.cfi }) })
  view.addEventListener('draw-annotation', e => { const r = annByValue.get(e.detail.annotation.value); if (r) drawRec(e.detail.draw, r) })
  view.addEventListener('show-annotation', e => { const r = annByValue.get(e.detail.value); if (r) showPopupForRec(r, e.detail.range) })
}
async function createAnnotation({ cfi, text, color, motivation = 'highlighting', note = '' }) {
  const a = makeAnnotation(bookId, cfi, { motivation, text, color, note })
  annoPage.items.push(a); await persistAnnotations()
  const rec = register(recOf(a)); view.addAnnotation({ value: rec.cfi }); renderAnnoPanel(); return rec
}
async function updateAnnotation(rec, patch) {
  Object.assign(rec, patch)
  const a = annoPage.items.find(x => x.id === rec.id)
  if (a) { if ('color' in patch) a.color = patch.color; if ('note' in patch) { if (patch.note) a.body = { type: 'TextualBody', value: patch.note, format: 'text/plain', purpose: 'commenting' }; else delete a.body } a.modified = new Date().toISOString() }
  await persistAnnotations(); view.addAnnotation({ value: rec.cfi }); renderAnnoPanel()
}
async function deleteAnnotation(rec) {
  view.deleteAnnotation({ value: rec.cfi }); unregister(rec)
  annoPage.items = annoPage.items.filter(x => x.id !== rec.id); await persistAnnotations(); renderAnnoPanel()
}

// ---- selection popup ----
const popup = $('#anno-popup'); let pending = null, popupRec = null, popupOpenedAt = 0
function hidePopup() { popup.hidden = true; pending = null; popupRec = null }
function positionPopup(x, y) { popup.hidden = false; popupOpenedAt = performance.now(); const w = popup.offsetWidth, h = popup.offsetHeight; popup.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + 'px'; popup.style.top = Math.max(52, y - h - 12) + 'px' }
function onContentPointerup(doc, index, ev) {
  const sel = doc.getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return
  const range = sel.getRangeAt(0), text = sel.toString().trim(); if (!text) return
  let cfi; try { cfi = view.getCFI(index, range) } catch { return }
  pending = { cfi, text }; popupRec = null; popup.querySelector('[data-act="delete"]').hidden = true
  const host = $('#reader-view').getBoundingClientRect(); positionPopup(host.left + (ev.clientX || host.width / 2), host.top + (ev.clientY || 100))
}
function showPopupForRec(rec, range) {
  pending = null; popupRec = rec; popup.querySelector('[data-act="delete"]').hidden = false
  let x = innerWidth / 2, y = 160; try { const r = range.getBoundingClientRect?.(); if (r) { const host = $('#reader-view').getBoundingClientRect(); x = host.left + r.left + r.width / 2; y = host.top + r.top } } catch {}
  positionPopup(x, y)
}
popup.querySelectorAll('.dot').forEach(d => d.addEventListener('click', async () => {
  const color = d.dataset.color
  if (pending) { await createAnnotation({ ...pending, color }); view.deselect() } else if (popupRec) await updateAnnotation(popupRec, { color })
  hidePopup()
}))
popup.querySelector('[data-act="note"]').addEventListener('click', async () => {
  const note = prompt('Notiz:', popupRec?.note || ''); if (note === null) return
  if (pending) { await createAnnotation({ ...pending, color: '#ffd54a', motivation: 'commenting', note }); view.deselect() } else if (popupRec) await updateAnnotation(popupRec, { note })
  hidePopup()
})
popup.querySelector('[data-act="copy"]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(pending?.text || popupRec?.text || '') } catch {} hidePopup() })
popup.querySelector('[data-act="delete"]').addEventListener('click', async () => { if (popupRec) await deleteAnnotation(popupRec); hidePopup() })

// ---- side panel ----
function openSide(tab) { $('#dimming').classList.add('show'); $('#side-panel').classList.add('show'); if (tab) selectTab(tab) }
function closeSide() { $('#dimming').classList.remove('show'); $('#side-panel').classList.remove('show') }
$('#dimming').addEventListener('click', closeSide)
function selectTab(tab) { document.querySelectorAll('.side-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab)); document.querySelectorAll('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== tab) }
document.querySelectorAll('.side-tab').forEach(b => b.addEventListener('click', () => selectTab(b.dataset.tab)))
function renderTOC(toc) {
  const root = $('#toc-view'); root.innerHTML = ''
  const build = items => { const ol = document.createElement('ol'); for (const it of items) { const li = document.createElement('li'); const a = document.createElement(it.href ? 'a' : 'span'); a.textContent = it.label || '—'; if (it.href) { a.href = '#'; a.addEventListener('click', e => { e.preventDefault(); view.goTo(it.href); closeSide() }) } li.append(a); if (it.subitems?.length) li.append(build(it.subitems)); ol.append(li) } return ol }
  if (toc?.length) root.append(build(toc)); else root.innerHTML = '<p class="muted">Kein Inhaltsverzeichnis.</p>'
}
function renderAnnoPanel() {
  const ul = $('#anno-view'); ul.innerHTML = ''
  const recs = [...annById.values()]
  if (!recs.length) { ul.innerHTML = '<p class="muted">Noch keine Notizen.</p>'; return }
  for (const rec of recs) { const li = document.createElement('li'); li.style.setProperty('--anno-color', rec.color); const q = document.createElement('div'); q.className = 'q'; q.textContent = rec.motivation === 'bookmarking' ? '🔖 Lesezeichen' : (rec.text || '(Stelle)'); li.append(q); if (rec.note) { const n = document.createElement('div'); n.className = 'n'; n.textContent = rec.note; li.append(n) } li.addEventListener('click', () => { view.goTo(rec.cfi); closeSide() }); ul.append(li) }
}

// ---- search ----
$('#search-form').addEventListener('submit', async e => {
  e.preventDefault(); const q = $('#search-input').value.trim(); const out = $('#search-results'); out.innerHTML = ''
  if (!q) return; out.innerHTML = '<li class="label">Suche…</li>'
  const results = []
  for await (const r of view.search({ query: q })) { if (r === 'done') break; if (r.subitems) for (const s of r.subitems) results.push({ cfi: s.cfi, excerpt: s.excerpt, label: r.label }) }
  out.innerHTML = ''
  if (!results.length) { out.innerHTML = '<li class="label">Nichts gefunden.</li>'; return }
  for (const r of results.slice(0, 300)) { const li = document.createElement('li'); const e2 = r.excerpt || {}; li.innerHTML = `<span class="label">${escapeHtml(r.label || '')}</span><br>${escapeHtml(e2.pre || '')}<mark>${escapeHtml(e2.match || '')}</mark>${escapeHtml(e2.post || '')}`; li.addEventListener('click', () => { view.goTo(r.cfi); closeSide() }); out.append(li) }
})
function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

// ---- appearance ----
function syncAppearanceUI() {
  document.querySelectorAll('#seg-theme button').forEach(b => b.classList.toggle('active', b.dataset.theme === style.theme))
  document.querySelectorAll('#seg-flow button').forEach(b => b.classList.toggle('active', b.dataset.flow === style.flow))
  $('#font-val').textContent = style.fontSize + '%'; $('#spacing-range').value = style.spacing; $('#margin-range').value = style.margin
  $('#font-family').value = style.fontFamily; $('#chk-justify').checked = style.justify; $('#chk-hyphenate').checked = style.hyphenate
  $('#chk-bottombar').checked = style.bottomBar
}
document.querySelectorAll('#seg-theme button').forEach(b => b.addEventListener('click', () => { style.theme = b.dataset.theme; saveStyle(); applyStyle() }))
document.querySelectorAll('#seg-flow button').forEach(b => b.addEventListener('click', () => { style.flow = b.dataset.flow; saveStyle(); applyStyle() }))
document.querySelectorAll('[data-font]').forEach(b => b.addEventListener('click', () => { style.fontSize = Math.max(60, Math.min(240, style.fontSize + (b.dataset.font === '+' ? 10 : -10))); saveStyle(); applyStyle() }))
$('#spacing-range').addEventListener('input', e => { style.spacing = parseFloat(e.target.value); saveStyle(); applyStyle() })
$('#margin-range').addEventListener('input', e => { style.margin = parseInt(e.target.value); saveStyle(); applyStyle() })
$('#font-family').addEventListener('change', e => { style.fontFamily = e.target.value; saveStyle(); applyStyle() })
$('#chk-justify').addEventListener('change', e => { style.justify = e.target.checked; saveStyle(); applyStyle() })
$('#chk-hyphenate').addEventListener('change', e => { style.hyphenate = e.target.checked; saveStyle(); applyStyle() })
$('#chk-bottombar').addEventListener('change', e => { style.bottomBar = e.target.checked; saveStyle(); applyStyle() })

// ---- controls ----
$('#btn-toc').addEventListener('click', () => openSide('toc'))
$('#btn-search').addEventListener('click', () => { openSide('search'); setTimeout(() => $('#search-input').focus(), 100) })
$('#btn-appearance').addEventListener('click', () => { $('#appearance-panel').hidden = !$('#appearance-panel').hidden })

const fsBtn = $('#btn-fullscreen')
const fsEnter = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen
const fsExit = document.exitFullscreen || document.webkitExitFullscreen
function isBrowserFs() { return document.fullscreenElement || document.webkitFullscreenElement }
// "Vollbild" = hide all chrome; tap the upper area to bring the bars back.
// Also request real browser fullscreen where supported (bonus).
function toggleFullscreen() {
  const entering = !body.classList.contains('immersive')
  toggleImmersive(entering)
  try {
    if (entering && fsEnter && !isBrowserFs()) Promise.resolve(fsEnter.call(document.documentElement)).catch(() => {})
    else if (!entering && fsExit && isBrowserFs()) fsExit.call(document)
  } catch (e) {}
}
if (fsBtn) {
  fsBtn.hidden = false
  fsBtn.addEventListener('click', toggleFullscreen)
}
document.addEventListener('fullscreenchange', () => { if (!isBrowserFs()) toggleImmersive(false) })
$('#btn-bookmark').addEventListener('click', async () => { const cfi = view.lastLocation?.cfi; if (cfi) { await createAnnotation({ cfi, text: '', color: '#90caf9', motivation: 'bookmarking' }); flash('Lesezeichen gesetzt') } })
$('#btn-prev').addEventListener('click', goPrev)
$('#btn-next').addEventListener('click', goNext)
$('#progress-slider').addEventListener('input', e => view.goToFraction(parseFloat(e.target.value)))
document.addEventListener('keydown', e => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return; if (e.key === 'ArrowLeft') goPrev(); else if (e.key === 'ArrowRight') goNext(); else if (e.key === 'f' || e.key === 'F') toggleFullscreen(); else if (e.key === 'Escape') { closeSide(); $('#appearance-panel').hidden = true; hidePopup(); toggleImmersive(false) } })

let flashTimer
function flash(msg) { let el = $('#flash'); if (!el) { el = document.createElement('div'); el.id = 'flash'; el.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:var(--r-bar);border:1px solid var(--r-border);padding:.4rem .9rem;border-radius:6px;z-index:20;font-size:.8rem'; document.body.append(el) } el.textContent = msg; el.style.opacity = '1'; clearTimeout(flashTimer); flashTimer = setTimeout(() => el.style.opacity = '0', 1500) }

// ---- position persistence (IndexedDB) ----
let saveTimer
function scheduleSave(detail) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    const frac = detail.fraction || 0
    await db.saveLocator(bookId, makeLocator(detail.cfi || '', frac))
    const b = await db.getBook(bookId); if (b) { b.progress = frac; b.lastReadAt = new Date().toISOString(); await db.put('books', b) }
  }, 800)
}

// ---- boot ----
async function boot() {
  const blob = await db.getFileBlob(bookId)
  if (!blob) { $('#reader-title').textContent = 'Buch nicht gefunden'; return }
  const b = await db.getBook(bookId)
  if (b) { $('#reader-title').textContent = b.title; document.title = b.title + ' — lieslese' }

  view = document.createElement('foliate-view'); $('#reader-view').append(view)
  await view.open(new File([blob], (b?.fileName || 'book.epub'), { type: 'application/epub+zip' }))
  view.renderer.addEventListener('scroll', markScroll)
  $('#reader-view').addEventListener('wheel', onContentWheel, { passive: true })

  view.addEventListener('load', e => {
    const { doc, index } = e.detail
    doc.addEventListener('pointerup', ev => onContentPointerup(doc, index, ev))
    doc.addEventListener('wheel', onContentWheel, { passive: true })
    doc.addEventListener('click', ev => {
      const onLink = !!ev.target?.closest?.('a[href]')
      const x = ev.clientX, y = ev.clientY
      const w = doc.documentElement.clientWidth || window.innerWidth
      const h = doc.documentElement.clientHeight || window.innerHeight
      setTimeout(() => {
        const s = doc.getSelection && doc.getSelection()
        if (s && !s.isCollapsed) return
        if (!popup.hidden) { if (performance.now() - popupOpenedAt > 80) hidePopup(); return }
        if (onLink) return
        handleTap(x, y, w, h)
      }, 0)
    })
  })
  view.addEventListener('relocate', e => { const d = e.detail; $('#progress-slider').value = d.fraction || 0; $('#progress-label').textContent = Math.round((d.fraction || 0) * 100) + ' %'; scheduleSave(d) })
  wireAnnotationEvents()
  applyStyle()

  const loc = await db.getLocator(bookId)
  const last = loc?.locations?.fragments?.[0] || null
  await loadAnnotations()
  const goto = new URLSearchParams(location.search).get('goto')
  await view.init({ lastLocation: goto || last || null, showTextStart: !(goto || last) })
  renderTOC(view.book?.toc)

  $('#reader-view').addEventListener('click', ev => handleTap(ev.clientX, ev.clientY, window.innerWidth, window.innerHeight))
}

if (!bookId) { location.href = '/' } else boot().catch(e => { console.error(e); $('#reader-title').textContent = 'Fehler beim Laden' })
