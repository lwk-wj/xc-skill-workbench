// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeControl } from '../../src/renderer/src/features/settings/ThemeControl'

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

describe('theme control', () => {
  afterEach(cleanup)
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    window.xcSkills = {
      preferences: { getTheme: vi.fn().mockResolvedValue('system'), setTheme: vi.fn().mockResolvedValue(undefined), getLastSource: vi.fn() },
    } as never
  })

  it('follows system dark mode and reacts to appearance changes', async () => {
    const media = matchMedia(true)
    render(<ThemeControl />)
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
    act(() => media.dispatch(false))
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('persists an explicit theme and ignores later system changes', async () => {
    const media = matchMedia(true)
    render(<ThemeControl />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: '主题' })).toHaveValue('system'))
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: '主题' }), 'light')
    expect(window.xcSkills.preferences.setTheme).toHaveBeenCalledWith('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    act(() => media.dispatch(true))
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
