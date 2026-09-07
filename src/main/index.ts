import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { BUILTIN_AGENTS, readConfig, resolveAssetStorePath } from 'xc-skills/core'
import { createWindowOptions } from './window.js'
import { AppStore } from './services/app-store.js'
import { registerIpc } from './ipc/register-ipc.js'
import { CoreService } from './services/core-service.js'
import { LogService } from './services/log-service.js'
import { ThirdPartyRepositoryService } from './services/third-party-repository-service.js'
import type { WindowBounds } from '../shared/ipc.js'
import { repositoryCachePathForRoot, resourceRootFromAssetStore } from '../shared/resource-storage.js'

const rendererUrl = process.env.ELECTRON_RENDERER_URL
const rendererFile = join(__dirname, '../renderer/index.html')
const e2eEnabled = process.env.XC_SKILLS_E2E === '1'

const configureApplicationIcon = (): void => {
  if (process.platform !== 'darwin') return

  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : resolve('build/icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  if (!icon.isEmpty()) app.dock?.setIcon(icon)
}

// E2E-only process isolation hooks. Production launches ignore these values.
if (e2eEnabled && process.env.XC_SKILLS_USER_DATA) {
  app.setPath('userData', resolve(process.env.XC_SKILLS_USER_DATA))
}

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
  configureApplicationIcon()
  const userData = app.getPath('userData')
  const appStore = new AppStore(join(userData, 'state.json'))
  const log = new LogService(userData)
  const configPath = e2eEnabled && process.env.XC_SKILLS_CONFIG_PATH
    ? resolve(process.env.XC_SKILLS_CONFIG_PATH)
    : join(homedir(), '.xc-skills-config.json')
  const repositoryCacheRoot = async (): Promise<string> => {
    const config = await readConfig(configPath)
    return repositoryCachePathForRoot(resourceRootFromAssetStore(resolveAssetStorePath(config)))
  }
  const thirdPartyRepositoryService = new ThirdPartyRepositoryService({
    appStore,
    cacheRoot: repositoryCacheRoot,
    log,
  })
  const coreService = new CoreService({
    appStore,
    configPath,
    chooseDirectory: async () => {
      if (e2eEnabled && process.env.XC_SKILLS_DIALOG_PATH) return resolve(process.env.XC_SKILLS_DIALOG_PATH)
      const picked = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
      return picked.canceled || !picked.filePaths[0] ? null : picked.filePaths[0]
    },
    log,
    thirdPartyRepositories: thirdPartyRepositoryService,
  })
  registerIpc({
    ipcMain,
    appStore,
    coreService,
    thirdPartyRepositoryService,
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
