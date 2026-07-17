// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '../../src/renderer/src/stores/preferences'

function matchMedia(initialDark: boolean) {
  let matches = initialDark
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const query = {
    media: '(prefers-color-scheme: dark)',
    get matches() { return matches },
    addEventListener: (_name: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_name: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    dispatch(value: boolean) { matches = value; listeners.forEach((listener) => listener({ matches: value } as MediaQueryListEvent)) },
  }
  vi.stubGlobal('matchMedia', vi.fn(() => query))
  return query
}

describe('preferences store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.documentElement.removeAttribute('data-theme')
    window.xcSkills = {
      preferences: {
        getTheme: vi.fn().mockResolvedValue('system'),
        setTheme: vi.fn().mockResolvedValue(undefined),
      },
    } as never
  })

  it('follows system appearance until an explicit theme is selected', async () => {
    const media = matchMedia(true)
    const store = usePreferencesStore()

    await store.initializeTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')

    media.dispatch(false)
    expect(document.documentElement.dataset.theme).toBe('light')

    await store.setTheme('dark')
    media.dispatch(false)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.xcSkills.preferences.setTheme).toHaveBeenCalledWith('dark')
  })
})
