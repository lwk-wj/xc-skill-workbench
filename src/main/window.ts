import type { BrowserWindowConstructorOptions } from 'electron'

export const createWindowOptions = (preloadPath: string): BrowserWindowConstructorOptions => ({
  width: 1280,
  height: 800,
  minWidth: 980,
  minHeight: 640,
  show: false,
  webPreferences: {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  },
})
