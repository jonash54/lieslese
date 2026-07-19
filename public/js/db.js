// lieslese — client-side storage. Everything lives in the browser (IndexedDB).
// Nothing is ever sent to a server. Reading position + annotations are kept in
// the same standard formats as the server version (Readium Locator, W3C Web
// Annotation) so exports stay portable.

const DB_NAME = 'lieslese'
const DB_VERSION = 1
const STORES = ['books', 'covers', 'files', 'locators', 'annotations']

let _db = null

export function openDB() {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' })
    }
    req.onsuccess = () => { _db = req.result; resolve(_db) }
    req.onerror = () => reject(req.error)
  })
}

function tx(store, mode = 'readonly') {
  return openDB().then(db => db.transaction(store, mode).objectStore(store))
}
function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) }) }

export async function put(store, value) { return reqP((await tx(store, 'readwrite')).put(value)) }
export async function get(store, id) { return reqP((await tx(store)).get(id)) }
export async function del(store, id) { return reqP((await tx(store, 'readwrite')).delete(id)) }
export async function getAll(store) { return reqP((await tx(store)).getAll()) }

// --- SHA-256 content hash → stable per-file id ----------------------------
export async function hashFile(file) {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40)
}

// --- high-level book ops --------------------------------------------------
export async function saveBook(meta, fileBlob, coverBlob) {
  await put('books', meta)
  await put('files', { id: meta.id, blob: fileBlob })
  if (coverBlob) await put('covers', { id: meta.id, blob: coverBlob })
  const existing = await get('annotations', meta.id)
  if (!existing) await put('annotations', { id: meta.id, page: emptyAnnoPage() })
}

export async function listBooks() { return getAll('books') }
export async function getBook(id) { return get('books', id) }
export async function getFileBlob(id) { const r = await get('files', id); return r ? r.blob : null }
export async function getCoverBlob(id) { const r = await get('covers', id); return r ? r.blob : null }

export async function deleteBook(id) {
  for (const s of STORES) await del(s, id)
}

export async function saveLocator(id, locator) { return put('locators', { id, locator }) }
export async function getLocator(id) { const r = await get('locators', id); return r ? r.locator : null }

export async function getAnnotations(id) {
  const r = await get('annotations', id)
  return r ? r.page : emptyAnnoPage()
}
export async function saveAnnotations(id, page) { return put('annotations', { id, page }) }

export function emptyAnnoPage() {
  return { '@context': 'http://www.w3.org/ns/anno.jsonld', type: 'AnnotationPage', items: [] }
}

// approximate storage usage (best effort)
export async function usage() {
  if (navigator.storage?.estimate) return navigator.storage.estimate()
  return { usage: 0, quota: 0 }
}
