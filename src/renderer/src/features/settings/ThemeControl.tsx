import { useEffect, useState, type ReactElement } from 'react'
import type { ThemePreference } from '../../../../shared/ipc.js'

export type ThemeControlProps = {
  value?: ThemePreference
  onChange?: (theme: ThemePreference) => void | Promise<void>
}

const getSystemTheme = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

const applyTheme = (preference: ThemePreference): void => {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = preference === 'system' ? getSystemTheme() : preference
}

export function useThemePreference(): { preference: ThemePreference; setPreference: (theme: ThemePreference) => Promise<void> } {
  const [preference, setPreference] = useState<ThemePreference>('system')

  useEffect(() => {
    let active = true
    void window.xcSkills?.preferences.getTheme().then((theme) => {
      if (active) setPreference(theme)
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  useEffect(() => {
    applyTheme(preference)
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => { if (preference === 'system') applyTheme('system') }
    media.addEventListener?.('change', update)
    media.addListener?.(update)
    return () => {
      media.removeEventListener?.('change', update)
      media.removeListener?.(update)
    }
  }, [preference])

  const setPreferenceAsync = async (theme: ThemePreference): Promise<void> => {
    setPreference(theme)
    await window.xcSkills?.preferences.setTheme(theme)
  }

  return { preference, setPreference: setPreferenceAsync }
}

export function ThemeControl({ value, onChange }: ThemeControlProps): ReactElement {
  const standalone = value === undefined
  const hook = useThemePreference()
  const [local, setLocal] = useState<ThemePreference>('system')
  const preference = standalone ? hook.preference : value

  useEffect(() => {
    if (!standalone) applyTheme(preference)
  }, [preference, standalone])

  const change = async (theme: ThemePreference): Promise<void> => {
    if (standalone) await hook.setPreference(theme)
    else {
      setLocal(theme)
      applyTheme(theme)
      await onChange?.(theme)
    }
  }

  // `local` makes the component resilient when a parent controls it asynchronously.
  void local
  return <label className="theme-control">主题<select aria-label="主题" value={preference} onChange={(event) => void change(event.target.value as ThemePreference)}>
    <option value="system">跟随系统</option>
    <option value="light">浅色</option>
    <option value="dark">深色</option>
  </select></label>
}

export { applyTheme }
