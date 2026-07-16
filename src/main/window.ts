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
    sandbox: true,
    webSecurity: true,
  },
})
