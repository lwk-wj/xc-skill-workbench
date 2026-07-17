import { defineStore } from 'pinia'
import { readonly, ref } from 'vue'
import type { ThemePreference } from '../../../shared/ipc.js'

const systemTheme = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

export const usePreferencesStore = defineStore('preferences', () => {
  const preference = ref<ThemePreference>('system')
  let media: MediaQueryList | null = null
  let listening = false

  const applyTheme = (next: ThemePreference = preference.value): void => {
    if (typeof document === 'undefined') return
    document.documentElement.dataset.theme = next === 'system' ? systemTheme() : next
  }

  const handleAppearanceChange = (): void => {
    if (preference.value === 'system') applyTheme('system')
  }

  const startSystemListener = (): void => {
    if (listening || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener?.('change', handleAppearanceChange)
    media.addListener?.(handleAppearanceChange)
    listening = true
  }

  const initializeTheme = async (): Promise<void> => {
    preference.value = await window.xcSkills.preferences.getTheme()
    applyTheme()
    startSystemListener()
  }

  const setTheme = async (next: ThemePreference): Promise<void> => {
    preference.value = next
    applyTheme()
    await window.xcSkills.preferences.setTheme(next)
  }

  return { preference: readonly(preference), initializeTheme, setTheme, applyTheme }
})
