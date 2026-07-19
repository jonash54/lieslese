// Shared helpers: metadata extraction + standard annotation objects.
import { makeBook } from '../vendor/foliate-js/view.js'
import { hashFile } from './db.js'

const CFI_CONFORMS = 'http://www.idpf.org/epub/linking/cfi/epubcfi.html'

export function fmtLangMap(x) {
  if (!x) return ''
  if (typeof x === 'string') return x
  const k = Object.keys(x)
  return k.length ? x[k[0]] : ''
}
function oneContributor(c) { return typeof c === 'string' ? c : fmtLangMap(c?.name) }
export function fmtContributors(c) {
  if (!c) return []
  return (Array.isArray(c) ? c : [c]).map(oneContributor).filter(Boolean)
}

// Parse an EPUB File → normalised metadata + cover blob (all client-side).
// foliate builds author/publisher/subject as arrays of contributor objects
// ({name: languageMap}); series is an array or a {name, position} object.
export async function extractMeta(file) {
  const id = await hashFile(file)
  const book = await makeBook(file)
  const m = book.metadata || {}
  let coverBlob = null
  try { coverBlob = await book.getCover?.() } catch { coverBlob = null }

  // gather identifier strings (main + alternates), pick an ISBN if present
  const idStrings = []
  const pushId = v => { if (!v) return; idStrings.push(typeof v === 'string' ? v : (v.value || '')) }
  pushId(m.identifier); (m.altIdentifier || []).forEach(pushId)
  let isbn = ''
  for (const s of idStrings) { const hit = (String(s).match(/97[89]\d{10}|\d{9}[\dXx]/) || [])[0]; if (hit) { isbn = hit; break } }

  const seriesObj = Array.isArray(m.belongsTo?.series) ? m.belongsTo.series[0] : m.belongsTo?.series
  const title = fmtLangMap(m.title) || file.name.replace(/\.epub$/i, '')
  const subtitle = m.subtitle ? String(m.subtitle) : ''

  const meta = {
    id,
    title: subtitle ? `${title}: ${subtitle}` : title,
    authors: fmtContributors(m.author),
    language: Array.isArray(m.language) ? (m.language[0] || '') : fmtLangMap(m.language),
    publisher: fmtContributors(m.publisher)[0] || '',
    published: (m.published || '').toString(),
    description: fmtLangMap(m.description) || '',
    subjects: fmtContributors(m.subject),
    series: fmtLangMap(seriesObj?.name) || '',
    seriesIndex: (seriesObj?.position ?? '').toString(),
    isbn,
    fileName: file.name,
    size: file.size,
    addedAt: new Date().toISOString(),
    lastReadAt: '',
    progress: 0,
  }
  return { meta, coverBlob }
}

// --- W3C Web Annotation (identical shape to the server version) -----------
export function nowISO() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z') }
export function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2)) }

export function makeAnnotation(source, cfi, { motivation = 'highlighting', text = '', note = '', color = '#ffd54a' } = {}) {
  const now = nowISO()
  const ann = {
    type: 'Annotation', id: 'urn:uuid:' + uuid(), motivation, created: now, modified: now,
    target: { source, selector: [{ type: 'FragmentSelector', conformsTo: CFI_CONFORMS, value: cfi }] },
  }
  if (text) ann.target.selector.push({ type: 'TextQuoteSelector', exact: text })
  if (note) ann.body = { type: 'TextualBody', value: note, format: 'text/plain', purpose: 'commenting' }
  if (motivation !== 'bookmarking') ann.color = color
  return ann
}
export function cfiOf(a) { return (a.target?.selector || []).find(s => s.type === 'FragmentSelector')?.value || '' }
export function textOf(a) { return (a.target?.selector || []).find(s => s.type === 'TextQuoteSelector')?.exact || '' }
export function noteOf(a) {
  const b = a.body
  if (!b) return ''
  if (Array.isArray(b)) return (b.find(x => x.purpose === 'commenting') || {}).value || ''
  return b.value || ''
}

export function makeLocator(cfi, totalProgression, progression = 0, title = '') {
  return {
    type: 'application/epub+zip', title,
    locations: { progression, totalProgression, fragments: cfi ? [cfi] : [] },
    updated: nowISO(),
  }
}
