import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { BUILTIN_AGENTS } from 'xc-skills/core'
import { createWindowOptions } from './window.js'
import { AppStore } from './services/app-store.js'
import { registerIpc } from './ipc/register-ipc.js'
import { CoreService } from './services/core-service.js'
import { LogService } from './services/log-service.js'
import type { WindowBounds } from '../shared/ipc.js'

const rendererUrl = process.env.ELECTRON_RENDERER_URL
const rendererFile = join(__dirname, '../renderer/index.html')

const isAllowedNavigation = (url: string): boolean => {
  if (rendererUrl) {
    return url === rendererUrl || url.startsWith(`${rendererUrl}/`)
  }
  return url === pathToFileURL(rendererFile).toString()
}

const createMainWindow = async (appStore: AppStore): Promise<BrowserWindow> => {
  const window = new BrowserWindow(createWindowOptions(join(__dirname, '../preload/index.mjs'), await appStore.getWindowBounds()))

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

  const currentBounds = (): WindowBounds => {
    const bounds = window.getBounds()
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  }
  const persistBounds = (): void => { void appStore.setWindowBounds(currentBounds()) }
  window.on('move', persistBounds)
  window.on('resize', persistBounds)
  let closingAfterPersist = false
  window.on('close', (event) => {
    if (closingAfterPersist) return
    event.preventDefault()
    closingAfterPersist = true
    void appStore.setWindowBounds(currentBounds()).finally(() => window.destroy())
  })

  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(rendererFile)
  }

  return window
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData')
  const appStore = new AppStore(join(userData, 'state.json'))
  const log = new LogService(userData)
  const coreService = new CoreService({
    appStore,
    configPath: join(homedir(), '.xc-skills-config.json'),
    cacheRoot: join(userData, 'cache'),
    chooseDirectory: async () => {
      const picked = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
      return picked.canceled || !picked.filePaths[0] ? null : picked.filePaths[0]
    },
    log,
  })
  registerIpc({
    ipcMain,
    appStore,
    coreService,
    builtInAgentIds: BUILTIN_AGENTS.map((agent) => agent.id),
    dialog: { showOpenDialog: (options) => dialog.showOpenDialog(options) },
    shell,
  })
  await createMainWindow(appStore)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow(appStore)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
