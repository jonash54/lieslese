// Client-side theming: dark toggle (cookie) + accent preset + custom CSS.
const KEY = 'lieslese-theme'

export function getTheme() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}
function save(t) { localStorage.setItem(KEY, JSON.stringify(t)) }

export function applyTheme() {
  const t = getTheme()
  document.documentElement.dataset.preset = t.preset || 'weltsein'
  const el = document.getElementById('custom-theme')
  if (el) el.textContent = t.css || ''
}

export function setPreset(preset) { const t = getTheme(); t.preset = preset; save(t); applyTheme() }
export function setCustomCSS(css) { const t = getTheme(); t.css = css; save(t); applyTheme() }
export function clearCustomCSS() { const t = getTheme(); delete t.css; save(t); applyTheme() }

export function toggleDark() {
  const dark = document.documentElement.classList.toggle('dark')
  document.cookie = 'theme=' + (dark ? 'dark' : 'light') + '; path=/; max-age=31536000; SameSite=Lax'
}

export function wireThemeToggle(btnId = 'theme-toggle') {
  const b = document.getElementById(btnId)
  if (b) b.addEventListener('click', toggleDark)
}
