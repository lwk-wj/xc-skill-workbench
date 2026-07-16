import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  AgentDefinitionSchema, AssetDetailSchema, AssetSelectionSchema, AssetRecordSchema, Channels, ExternalUrlSchema,
  OperationRequestSchema, OperationResultSchema, OperationPlanSchema, OperationProgressSchema, RepositoryBranchSchema, RepositoryViewSchema,
  SourceSelectionSchema, ThemePreferenceSchema, XcSkillsConfigSchema, type AgentDefinition, type AssetDetail, type AssetRecord,
  type DesktopApi, type OperationPlan, type OperationProgress, type OperationRequest, type OperationResult, type RepositoryBranch,
  type RepositoryView, type SourceSelection, type XcSkillsConfig,
} from '../../shared/ipc.js'
import type { AppStore } from '../services/app-store.js'
import type { CoreService } from '../services/core-service.js'
import { z } from 'zod'

type IpcMainLike = { handle(channel: string, listener: (event: unknown, input?: unknown) => unknown): void }
type OperationEvent = { sender?: { id?: number; send?: (channel: string, value: OperationProgress) => void } }
type DialogLike = { showOpenDialog(options: { properties: Array<'openDirectory' | 'createDirectory'> }): Promise<{ canceled: boolean; filePaths: string[] }> }
type ShellLike = { openExternal(url: string): Promise<void> }

export interface IpcServices {
  chooseAndAddProject?: () => Promise<import('../../shared/ipc.js').ProjectRecord | null>
  listProjects?: () => Promise<import('../../shared/ipc.js').ProjectRecord[]>
  removeProject?: (id: string) => Promise<void>
  listAgents?: () => Promise<AgentDefinition[]>
  saveCustomAgent?: (agent: AgentDefinition) => Promise<AgentDefinition[]>
  removeCustomAgent?: (id: string) => Promise<AgentDefinition[]>
  getConfig?: () => Promise<XcSkillsConfig>
  listBranches?: () => Promise<RepositoryBranch[]>
  selectBranch?: (branch: string) => Promise<RepositoryView>
  setDefaultBranch?: (branch: string) => Promise<XcSkillsConfig>
  refresh?: () => Promise<RepositoryView>
  scan?: (source: SourceSelection) => Promise<AssetRecord[]>
  detail?: (selection: { source: SourceSelection; assetId: string }) => Promise<AssetDetail>
  statuses?: (selection: { source: SourceSelection; assetId: string }) => Promise<unknown[]>
  plan?: (request: OperationRequest) => Promise<OperationPlan>
  execute?: (planId: string, options?: { signal?: AbortSignal; onProgress?: (progress: OperationProgress) => void }) => Promise<OperationResult>
  cancel?: (planId: string, options?: { signal?: AbortSignal }) => Promise<void>
  rescan?: (affectedPaths: string[]) => Promise<void>
  onProgress?: (listener: (progress: OperationProgress) => void) => () => void
  emitProgress?: (progress: OperationProgress) => void
}

export interface RegisterIpcOptions {
  ipcMain: IpcMainLike
  appStore: AppStore
  services?: IpcServices
  dialog?: DialogLike
  shell?: ShellLike
  builtInAgentIds?: string[]
  coreService?: CoreService
}

const unsupported = (name: string): never => { throw new Error(`${name} is not available`) }
const asStringId = (input: unknown): string => {
  if (typeof input !== 'string' || !/^[A-Za-z0-9._:-]+$/.test(input) || input.length > 200) throw new TypeError('invalid id')
  return input
}

export const registerIpc = ({ ipcMain, appStore, services: suppliedServices = {}, coreService, dialog, shell, builtInAgentIds = [] }: RegisterIpcOptions): void => {
  const coreBindings: IpcServices = coreService ? {
    listProjects: () => coreService.listProjects(), chooseAndAddProject: () => coreService.chooseAndAddProject(), removeProject: (id) => coreService.removeProject(id),
    listAgents: () => coreService.listAgents(), saveCustomAgent: (agent) => coreService.saveCustomAgent(agent), removeCustomAgent: (id) => coreService.removeCustomAgent(id),
    getConfig: () => coreService.getConfig(), listBranches: () => coreService.listBranches(), selectBranch: (branch) => coreService.selectBranch(branch), setDefaultBranch: (branch) => coreService.setDefaultBranch(branch), refresh: () => coreService.refresh(),
    scan: (source) => coreService.scan(source), detail: (selection) => coreService.detail(selection), statuses: (selection) => coreService.statuses(selection),
    plan: (request) => coreService.plan(request), execute: (planId, options) => coreService.execute(planId, options), cancel: (planId, options) => coreService.cancel(planId, options), rescan: (paths) => coreService.rescanAffected(paths),
  } : {}
  const services: IpcServices = { ...coreBindings, ...suppliedServices }
  const storedPlans = new Map<string, { plan: OperationPlan; controller: AbortController; ownerWebContentsId: number | null; createdAt: number }>()
  const expiresAfter = 10 * 60 * 1000
  const ownerId = (event: unknown): number | null => {
    const id = (event as OperationEvent | null)?.sender?.id
    return typeof id === 'number' && Number.isSafeInteger(id) ? id : null
  }
  const emitProgress = (event: unknown, progress: OperationProgress): void => {
    const sender = (event as OperationEvent | null)?.sender
    sender?.send?.(Channels.operationsProgress, progress)
    services.emitProgress?.(progress)
  }
  const prunePlans = (): void => {
    const now = Date.now()
    for (const [id, task] of storedPlans) {
      if (now - task.createdAt >= expiresAfter) {
        task.controller.abort()
        storedPlans.delete(id)
      }
    }
  }
  const invoke = <T>(channel: string, parser: { parse(value: unknown): T }, handler: (value: T, event?: unknown) => unknown): void => {
    ipcMain.handle(channel, (event, input) => handler(parser.parse(input), event))
  }
  const noInput = z.union([z.undefined(), z.null()])

  invoke(Channels.projectsList, noInput, async () => services.listProjects ? services.listProjects() : (await appStore.read()).projects)
  invoke(Channels.projectsChooseAndAdd, noInput, async () => {
    if (services.chooseAndAddProject) return services.chooseAndAddProject()
    if (!dialog) return null
    const picked = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (picked.canceled || !picked.filePaths[0]) return null
    const path = picked.filePaths[0]
    return appStore.addProject({ id: randomUUID(), name: basename(path), path })
  })
  invoke(Channels.projectsRemove, z.string().regex(/^[A-Za-z0-9._:-]+$/).min(1).max(200), async (id) => services.removeProject ? services.removeProject(id) : appStore.removeProject(id))

  invoke(Channels.agentsList, noInput, async () => services.listAgents ? services.listAgents() : (await appStore.read()).customAgents)
  invoke(Channels.agentsSaveCustom, AgentDefinitionSchema, async (agent) => services.saveCustomAgent ? services.saveCustomAgent(agent) : appStore.addCustomAgent(agent))
  invoke(Channels.agentsRemoveCustom, z.string().regex(/^[A-Za-z0-9._:-]+$/).min(1).max(200), async (id) => services.removeCustomAgent ? services.removeCustomAgent(id) : appStore.removeCustomAgent(id))

  invoke(Channels.repositoriesGetConfig, noInput, async () => services.getConfig ? services.getConfig() : {})
  invoke(Channels.repositoriesListBranches, noInput, async () => services.listBranches ? services.listBranches() : [])
  const branchSchema = z.string().trim().min(1).max(255)
  invoke(Channels.repositoriesSelectBranch, branchSchema, (branch) => services.selectBranch ? services.selectBranch(branch) : unsupported('repositories.selectBranch'))
  invoke(Channels.repositoriesSetDefaultBranch, branchSchema, (branch) => services.setDefaultBranch ? services.setDefaultBranch(branch) : unsupported('repositories.setDefaultBranch'))
  invoke(Channels.repositoriesRefresh, noInput, () => services.refresh ? services.refresh() : unsupported('repositories.refresh'))

  invoke(Channels.assetsScan, SourceSelectionSchema, (source) => services.scan ? services.scan(source) : unsupported('assets.scan'))
  invoke(Channels.assetsDetail, AssetSelectionSchema, (selection) => services.detail ? services.detail(selection) : unsupported('assets.detail'))
  invoke(Channels.assetsStatuses, AssetSelectionSchema, (selection) => services.statuses ? services.statuses(selection) : unsupported('assets.statuses'))

  invoke(Channels.operationsPlan, OperationRequestSchema, async (request, event) => {
    prunePlans()
    const state = await appStore.read()
    const known = new Set([...builtInAgentIds, ...state.customAgents.map((agent) => agent.id)])
    if (!known.has(request.target.agentId)) throw new Error(`unknown Agent id: ${request.target.agentId}`)
    if (request.target.scope === 'project' && !state.projects.some((project) => project.id === request.target.projectId)) throw new Error('unknown project id')
    if (!services.plan) return unsupported('operations.plan')
    const plan = OperationPlanSchema.parse(await services.plan(request))
    storedPlans.set(plan.id, { plan, controller: new AbortController(), ownerWebContentsId: ownerId(event), createdAt: Date.now() })
    return plan
  })
  invoke(Channels.operationsExecute, z.string().regex(/^[A-Za-z0-9._:-]+$/).min(1).max(200), async (planId, event) => {
    prunePlans()
    if (!services.execute) return unsupported('operations.execute')
    const task = storedPlans.get(planId)
    if (!task) throw new Error('unknown or expired plan id')
    const eventOwner = ownerId(event)
    if (task.ownerWebContentsId !== null && eventOwner !== task.ownerWebContentsId) throw new Error('operation owner mismatch: belongs to another window')
    const options = {
      signal: task.controller.signal,
      onProgress: (progress: OperationProgress) => emitProgress(event, OperationProgressSchema.parse(progress)),
    }
    try {
      const result = OperationResultSchema.parse(await services.execute(planId, options))
      const total = task.plan.steps.length
      emitProgress(event, OperationProgressSchema.parse({ planId, completed: total, total, message: result.status }))
      await services.rescan?.(result.affectedPaths)
      return result
    } finally {
      storedPlans.delete(planId)
    }
  })
  invoke(Channels.operationsCancel, z.string().regex(/^[A-Za-z0-9._:-]+$/).min(1).max(200), async (planId, event) => {
    prunePlans()
    const task = storedPlans.get(planId)
    if (!task) throw new Error('unknown or expired plan id')
    const eventOwner = ownerId(event)
    if (task.ownerWebContentsId !== null && eventOwner !== task.ownerWebContentsId) throw new Error('operation owner mismatch: belongs to another window')
    task.controller.abort()
    try {
      await services.cancel?.(planId, { signal: task.controller.signal })
      emitProgress(event, OperationProgressSchema.parse({ planId, completed: 0, total: 0, message: 'cancelled' }))
    } finally { storedPlans.delete(planId) }
  })

  invoke(Channels.preferencesGetTheme, noInput, () => appStore.getTheme())
  invoke(Channels.preferencesSetTheme, ThemePreferenceSchema, (theme) => appStore.setTheme(theme))
  invoke(Channels.preferencesGetLastSource, noInput, () => appStore.getLastSource())
  invoke(Channels.systemOpenExternal, ExternalUrlSchema, async (url) => { if (!shell) return unsupported('system.openExternal'); await shell.openExternal(url) })
}

export const validateOperationPlan = (input: unknown): OperationPlan => OperationPlanSchema.parse(input)
export const validateOperationResult = (input: unknown): OperationResult => OperationResultSchema.parse(input)
export const validateAssetDetail = (input: unknown): AssetDetail => AssetDetailSchema.parse(input)
