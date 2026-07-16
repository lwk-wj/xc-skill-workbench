// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderSafeMarkdown } from '../../src/renderer/src/lib/markdown.js'

describe('safe markdown', () => {
  it('renders markdown while removing raw html and unsafe links', () => {
    const html = renderSafeMarkdown('# Safe\n<script>alert(1)</script>\n[bad](javascript:alert(1))')
    expect(html).toContain('<h1>Safe</h1>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:')
  })

  it('keeps allowed links and marks them for the external handler', () => {
    const html = renderSafeMarkdown('[docs](https://example.com) [mail](mailto:team@example.com)')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('rel="noreferrer noopener"')
    expect(html).toContain('href="mailto:team@example.com"')
  })
})
