import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createWindowOptions } from './window.js'

const rendererUrl = process.env.ELECTRON_RENDERER_URL
const rendererFile = join(__dirname, '../renderer/index.html')

const isAllowedNavigation = (url: string): boolean => {
  if (rendererUrl) {
    return url === rendererUrl || url.startsWith(`${rendererUrl}/`)
  }
  return url === pathToFileURL(rendererFile).toString()
}

const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow(createWindowOptions(join(__dirname, '../preload/index.mjs')))

  window.once('ready-to-show', () => {
    window.show()
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault()
    }
  })
  window.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault()
    }
  })

  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(rendererFile)
  }

  return window
}

app.whenReady().then(() => {
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
