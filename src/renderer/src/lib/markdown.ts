import DOMPurify from 'dompurify'
import { Marked, Renderer } from 'marked'
import type { DesktopApi } from '../../../shared/ipc.js'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const ALLOWED_TAGS = [
  'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]
const ALLOWED_ATTR = ['href', 'title', 'rel', 'data-external-url', 'class']

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const isAllowedUrl = (value: string): boolean => {
  try { return ALLOWED_PROTOCOLS.has(new URL(value, 'http://localhost').protocol) } catch { return false }
}

/** Render untrusted Markdown to a DOMPurify-sanitized HTML string. */
export function renderSafeMarkdown(source: string | null | undefined): string {
  if (!source) return ''
  const renderer = new Renderer()
  renderer.html = ({ text }) => escapeHtml(text)
  const parser = new Marked({ gfm: true, breaks: true, renderer })
  const raw = parser.parse(source) as string
  const sanitized = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):)/i,
  })
  if (typeof document === 'undefined') return sanitized

  // Normalize links after sanitization so only explicitly supported protocols survive.
  const documentFragment = new DOMParser().parseFromString(`<div>${sanitized}</div>`, 'text/html')
  for (const anchor of Array.from(documentFragment.querySelectorAll('a'))) {
    const href = anchor.getAttribute('href')
    if (!href || !isAllowedUrl(href)) {
      anchor.removeAttribute('href')
      anchor.removeAttribute('rel')
      anchor.removeAttribute('data-external-url')
      continue
    }
    anchor.setAttribute('rel', 'noreferrer noopener')
    anchor.setAttribute('data-external-url', href)
  }
  return documentFragment.body.firstElementChild?.innerHTML ?? ''
}

export function handleSafeMarkdownClick(event: { target: EventTarget | null; preventDefault: () => void }): void {
  const target = event.target
  if (!(target instanceof Element)) return
  const anchor = target.closest('a[data-external-url]')
  const href = anchor?.getAttribute('data-external-url')
  if (!href || !isAllowedUrl(href)) return
  event.preventDefault()
  void (window as Window & { xcSkills: DesktopApi }).xcSkills.system.openExternal(href)
}
