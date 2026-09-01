import { contextBridge, ipcRenderer } from 'electron'
import { Channels, type DesktopApi, type OperationProgress } from '../shared/ipc.js'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>

const api: DesktopApi = {
  projects: {
    list: () => invoke(Channels.projectsList),
    chooseAndAdd: () => invoke(Channels.projectsChooseAndAdd),
    remove: (id) => invoke(Channels.projectsRemove, id),
  },
  agents: {
    list: () => invoke(Channels.agentsList),
    setEnabled: (id, enabled) => invoke(Channels.agentsSetEnabled, { id, enabled }),
    saveCustom: (agent) => invoke(Channels.agentsSaveCustom, agent),
    removeCustom: (id) => invoke(Channels.agentsRemoveCustom, id),
  },
  repositories: {
    getConfig: () => invoke(Channels.repositoriesGetConfig),
    current: () => invoke(Channels.repositoriesCurrent),
    chooseLocalPath: () => invoke(Channels.repositoriesChooseLocalPath),
    updateConfig: (input) => invoke(Channels.repositoriesUpdateConfig, input),
    listBranches: () => invoke(Channels.repositoriesListBranches),
    selectBranch: (branch) => invoke(Channels.repositoriesSelectBranch, branch),
    setDefaultBranch: (branch) => invoke(Channels.repositoriesSetDefaultBranch, branch),
    refresh: () => invoke(Channels.repositoriesRefresh),
  },
  thirdPartyRepositories: {
    list: () => invoke(Channels.thirdPartyRepositoriesList),
    add: (input) => invoke(Channels.thirdPartyRepositoriesAdd, input),
    update: (id, input) => invoke(Channels.thirdPartyRepositoriesUpdate, { id, input }),
    remove: (id) => invoke(Channels.thirdPartyRepositoriesRemove, id),
    refresh: (id) => invoke(Channels.thirdPartyRepositoriesRefresh, id),
    relinkInstallation: (input) => invoke(Channels.thirdPartyRepositoriesRelinkInstallation, input),
  },
  assets: {
    scan: (source) => invoke(Channels.assetsScan, source),
    detail: (asset) => invoke(Channels.assetsDetail, asset),
    statuses: (asset) => invoke(Channels.assetsStatuses, asset),
  },
  operations: {
    inspectSourceConflict: (input) => invoke(Channels.operationsInspectSourceConflict, input),
    plan: (input) => invoke(Channels.operationsPlan, input),
    execute: (planId) => invoke(Channels.operationsExecute, planId),
    cancel: (planId) => invoke(Channels.operationsCancel, planId),
    onProgress: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, progress: OperationProgress) => listener(progress)
      ipcRenderer.on(Channels.operationsProgress, wrapped)
      return () => ipcRenderer.off(Channels.operationsProgress, wrapped)
    },
  },
  preferences: {
    getTheme: () => invoke(Channels.preferencesGetTheme),
    setTheme: (theme) => invoke(Channels.preferencesSetTheme, theme),
    getLastSource: () => invoke(Channels.preferencesGetLastSource),
  },
  system: { openExternal: (url) => invoke(Channels.systemOpenExternal, url) },
}

contextBridge.exposeInMainWorld('xcSkills', api)
