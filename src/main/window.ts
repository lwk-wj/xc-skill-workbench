import type { BrowserWindowConstructorOptions } from 'electron'
import type { WindowBounds } from '../shared/ipc.js'

export const createWindowOptions = (preloadPath: string, bounds?: WindowBounds | null): BrowserWindowConstructorOptions => ({
  width: bounds?.width ?? 1280,
  height: bounds?.height ?? 800,
  ...(bounds?.x === undefined ? {} : { x: bounds.x }),
  ...(bounds?.y === undefined ? {} : { y: bounds.y }),
  minWidth: 980,
  minHeight: 640,
  show: false,
  webPreferences: {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    // The preload is emitted as ESM by electron-vite; Electron's sandboxed
    // preload loader only accepts a plain script. Keep context isolation and
    // nodeIntegration disabled while allowing the typed ESM bridge to load.
    sandbox: false,
    webSecurity: true,
  },
})
