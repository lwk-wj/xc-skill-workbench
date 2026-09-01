import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { lstat, readdir } from 'node:fs/promises'
import {
  BUILTIN_AGENTS,
  evaluateAssetStatus,
  executeOperation,
  listBranches,
  planOperation,
  readAssetDetail,
  readConfig,
  resolveAgentAssetRoot,
  resolveRepositorySource,
  scanAssets,
  setDefaultBranch as coreSetDefaultBranch,
  writeConfig,
  type AgentDefinition as CoreAgent,
  type AssetRecord as CoreAsset,
  type AssetStatusRecord,
  type XcSkillsConfig,
} from 'xc-skills/core'
import type {
  AgentDefinition, AssetDetail, AssetRecord, AssetSelection, AssetStatusRecord as DesktopStatus,
  DesktopState, OperationPlan, OperationRequest, OperationResult, ProjectRecord, RepositoryBranch,
  RepositoryConfigInput, RepositoryConfigUpdateResult, RepositoryView, SourceSelection,
} from '../../shared/ipc.js'
import {
  AssetRecordSchema, AssetDetailSchema, AssetStatusRecordSchema, XcSkillsConfigSchema,
} from '../../shared/ipc.js'
import type { AppStore } from './app-store.js'

type ChooseDirectory = () => Promise<string | null | undefined>
type CatalogMeta = { source: SourceSelection; projectId: string | null; agentId: string | null; method: null }
type CoreOverrides = Partial<Pick<typeof import('xc-skills/core'), 'readConfig' | 'writeConfig' | 'setDefaultBranch' | 'resolveRepositorySource' | 'listBranches' | 'scanAssets' | 'readAssetDetail' | 'evaluateAssetStatus' | 'planOperation' | 'executeOperation' | 'resolveAgentAssetRoot'>> & { BUILTIN_AGENTS?: typeof BUILTIN_AGENTS }
type CoreServiceOptions = {
  appStore: AppStore
  configPath?: string
  cacheRoot?: string
  chooseDirectory?: ChooseDirectory
  log?: { write(level: string, message: string, context?: unknown): Promise<void> }
  core?: CoreOverrides
}

const asDesktopAsset = (asset: unknown): AssetRecord => AssetRecordSchema.parse(asset)
const keyFor = (source: SourceSelection, id: string) => `${JSON.stringify(source)}:${id}`
const unknownStatus = (reason: string): DesktopStatus => AssetStatusRecordSchema.parse({
  status: 'unknown', updateAvailable: false, locallyModified: false, sourceHash: null, installedHash: null,
  sourceVersion: null, installedVersion: null, resolvedTarget: null, reason,
})

export class CoreService {
  private readonly appStore: AppStore
  private readonly configPath: string | undefined
  private readonly cacheRoot: string
  private readonly chooseDirectory: ChooseDirectory
  private readonly log?: CoreServiceOptions['log']
  private readonly core: typeof import('xc-skills/core')
  private config: XcSkillsConfig | null = null
  private selectedBranch: string | null = null
  private repository: Awaited<ReturnType<typeof resolveRepositorySource>> | null = null
  private readonly catalog = new Map<string, AssetRecord>()
  private readonly coreCatalog = new Map<string, CoreAsset>()
  private readonly metadata = new Map<string, CatalogMeta>()
  private readonly locations = new Map<string, Array<{ asset: AssetRecord; meta: CatalogMeta }>>()
  private readonly planned = new Map<string, { plan: OperationPlan; controller: AbortController; createdAt: number }>()
  private readonly planExpiryMs = 10 * 60 * 1000

  private async installMethod(path: string): Promise<'copy' | 'symlink' | null> {
    try {
      const entry = await lstat(path)
      if (entry.isSymbolicLink()) return 'symlink'
      if (!entry.isDirectory()) return 'copy'
      const children = await readdir(path, { withFileTypes: true })
      return children.some((child) => child.isSymbolicLink()) ? 'symlink' : 'copy'
    } catch {
      return null
    }
  }

  constructor(options: CoreServiceOptions) {
    this.appStore = options.appStore
    this.configPath = options.configPath
    this.cacheRoot = resolve(options.cacheRoot ?? join(homedir(), '.cache', 'xc-skills'))
    this.chooseDirectory = options.chooseDirectory ?? (async () => null)
    this.log = options.log
    this.core = { ...{
      BUILTIN_AGENTS, evaluateAssetStatus, executeOperation, listBranches, planOperation, readAssetDetail,
      readConfig, resolveAgentAssetRoot, resolveRepositorySource, scanAssets, setDefaultBranch: coreSetDefaultBranch, writeConfig,
    }, ...options.core } as typeof import('xc-skills/core')
  }

  private async ensureConfig(): Promise<XcSkillsConfig> {
    if (this.config) return this.config
    this.config = await this.core.readConfig(this.configPath)
    this.selectedBranch = this.config.defaultBranch ?? 'main'
    return this.config
  }

  private async resolveSource(force = false) {
    const config = await this.ensureConfig()
    if (!force && this.repository) return this.repository
    this.repository = await this.core.resolveRepositorySource(config, this.selectedBranch ?? config.defaultBranch ?? 'main', this.cacheRoot)
    return this.repository
  }

  async chooseAndAddProject(): Promise<ProjectRecord | null> {
    const selected = await this.chooseDirectory()
    if (!selected) return null
    const project = await this.appStore.addProject({ id: randomUUID(), name: basename(selected), path: selected })
    await this.log?.write('info', 'project added', { projectId: project.id })
    return project
  }
  async listProjects(): Promise<ProjectRecord[]> { return (await this.appStore.read()).projects }
  async removeProject(id: string): Promise<void> { await this.appStore.removeProject(id) }

  async listAgents(): Promise<AgentDefinition[]> {
    const state = await this.appStore.read()
    const builtins = this.core.BUILTIN_AGENTS as unknown as AgentDefinition[]
    const overrides = new Map(state.customAgents.map((agent) => [agent.id, agent]))
    return [
      ...builtins.map((agent) => {
        const definition = overrides.get(agent.id) ?? agent
        return { ...definition, enabled: state.agentEnabled[agent.id] ?? definition.enabled }
      }),
      ...state.customAgents
        .filter((agent) => !agent.builtIn)
        .map((agent) => ({ ...agent, enabled: state.agentEnabled[agent.id] ?? agent.enabled })),
    ]
  }
  async setAgentEnabled(id: string, enabled: boolean): Promise<AgentDefinition[]> {
    const known = (await this.listAgents()).some((agent) => agent.id === id)
    if (!known) throw new Error(`unknown Agent id: ${id}`)
    await this.appStore.setAgentEnabled(id, enabled)
    return this.listAgents()
  }
  async saveCustomAgent(agent: AgentDefinition): Promise<AgentDefinition[]> { return this.appStore.addCustomAgent(agent) }
  async removeCustomAgent(id: string): Promise<AgentDefinition[]> { return this.appStore.removeCustomAgent(id) }

  async getConfig(): Promise<XcSkillsConfig> { return this.ensureConfig() }
  async updateConfig(input: RepositoryConfigInput): Promise<RepositoryConfigUpdateResult> {
    const current = await this.ensureConfig()
    const candidate: XcSkillsConfig = {
      ...current,
      mode: input.mode,
      repoPath: input.repoPath || current.repoPath,
      remoteUrl: input.remoteUrl || current.remoteUrl,
      defaultBranch: input.defaultBranch,
      defaultGroups: input.defaultGroups,
    }
    try {
      const repository = await this.core.resolveRepositorySource(
        candidate,
        input.defaultBranch,
        this.cacheRoot,
      )
      await this.core.scanAssets({ root: repository.root })
      await this.core.writeConfig(candidate, this.configPath)
      this.config = candidate
      this.selectedBranch = input.defaultBranch
      this.repository = repository
      this.catalog.clear()
      this.coreCatalog.clear()
      this.metadata.clear()
      this.locations.clear()
      return {
        config: XcSkillsConfigSchema.parse(candidate),
        repository: this.repositoryView(),
      }
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error
        ? String(error.code)
        : 'UNKNOWN'
      await this.log?.write('error', 'repository configuration update failed', {
        mode: input.mode,
        branch: input.defaultBranch,
        code,
      })
      throw error
    }
  }
  async listBranches(): Promise<RepositoryBranch[]> { return this.core.listBranches(await this.ensureConfig()) }
  async currentRepository(): Promise<RepositoryView> {
    await this.resolveSource()
    return this.repositoryView()
  }
  async selectBranch(branch: string): Promise<RepositoryView> {
    this.selectedBranch = branch
    this.repository = await this.resolveSource(true)
    return this.repositoryView()
  }
  async setDefaultBranch(branch: string): Promise<XcSkillsConfig> {
    const config = await this.ensureConfig()
    await this.core.setDefaultBranch(branch, this.configPath)
    this.config = { ...config, defaultBranch: branch }
    return this.config
  }
  async refresh(): Promise<RepositoryView> { await this.resolveSource(true); return this.repositoryView() }
  private repositoryView(): RepositoryView {
    if (!this.repository) throw new Error('repository has not been resolved')
    const { root: _root, ...view } = this.repository
    return view
  }

  private async scanRoot(source: SourceSelection, root: string, projectId: string | null, agentId: string | null): Promise<AssetRecord[]> {
    try {
      const assets = (await this.core.scanAssets({ root })) as CoreAsset[]
      const result: AssetRecord[] = []
      for (const raw of assets) {
        const coreAsset = asDesktopAsset(raw)
        const asset = agentId
          ? asDesktopAsset({ ...coreAsset, id: `${agentId}:${coreAsset.id}`, agentId })
          : coreAsset
        const key = keyFor(source, asset.id)
        this.catalog.set(key, asset)
        this.coreCatalog.set(key, raw)
        this.metadata.set(key, { source, projectId, agentId, method: null })
        const locations = this.locations.get(key) ?? []
        locations.push({ asset, meta: { source, projectId, agentId, method: null } })
        this.locations.set(key, locations)
        result.push(asset)
      }
      return result
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const cause = (error as { details?: { cause?: unknown } }).details?.cause
      if (code === 'ENOENT' || code === 'ENOTDIR' || cause === 'ENOENT' || cause === 'ENOTDIR') return []
      throw error
    }
  }

  async scan(source: SourceSelection): Promise<AssetRecord[]> {
    await this.appStore.setLastSource(source)
    this.catalog.forEach((_value, key) => { if (key.startsWith(`${JSON.stringify(source)}:`)) this.catalog.delete(key) })
    this.coreCatalog.forEach((_value, key) => { if (key.startsWith(`${JSON.stringify(source)}:`)) this.coreCatalog.delete(key) })
    this.locations.forEach((_value, key) => { if (key.startsWith(`${JSON.stringify(source)}:`)) this.locations.delete(key) })
    const result: AssetRecord[] = []
    if (source.kind === 'central') {
      const repo = await this.resolveSource()
      result.push(...await this.scanRoot(source, repo.root, null, null))
      return result
    }
    const state = await this.appStore.read()
    const project = source.kind === 'project' ? state.projects.find((entry) => entry.id === source.projectId) : null
    if (source.kind === 'project' && !project) return []
    const agents = (await this.listAgents()).filter((agent) => agent.enabled)
    for (const agent of agents) {
      const projectRoot = project?.path ?? homedir()
      for (const type of ['skills', 'rules', 'workflows'] as const) {
        let root: string
        try { root = this.core.resolveAgentAssetRoot(agent as unknown as CoreAgent, source.kind, projectRoot, type) } catch {
          const base = source.kind === 'project'
            ? (agent.projectBaseDir.startsWith('/') ? agent.projectBaseDir : resolve(projectRoot, agent.projectBaseDir))
            : resolve(agent.globalBaseDir)
          const assetDir = agent.assetDirs[type]
          root = resolve(base, assetDir)
        }
        result.push(...await this.scanRoot(source, root, project?.id ?? null, agent.id))
      }
    }
    return result.sort((a, b) => `${a.type}/${a.group}/${a.name}`.localeCompare(`${b.type}/${b.group}/${b.name}`))
  }

  private async getCatalogAsset(selection: AssetSelection): Promise<AssetRecord> {
    const key = keyFor(selection.source, selection.assetId)
    const cached = this.catalog.get(key)
    if (cached) return cached
    await this.scan(selection.source)
    const asset = this.catalog.get(key)
    if (!asset) throw new Error(`asset not found: ${selection.assetId}`)
    return asset
  }

  private findCentralAsset(installed: AssetRecord, centralAssets: AssetRecord[]): { asset: AssetRecord | null; reason: string } {
    const exact = centralAssets.find((candidate) => candidate.type === installed.type && candidate.group === installed.group && candidate.name === installed.name)
    if (exact) return { asset: exact, reason: '' }
    if (installed.group) return { asset: null, reason: '中央分支不存在同名资产' }
    const candidates = centralAssets.filter((candidate) => candidate.type === installed.type && candidate.name === installed.name)
    if (candidates.length === 1) return { asset: candidates[0]!, reason: '' }
    return {
      asset: null,
      reason: candidates.length > 1 ? '中央仓库存在多个同名资产，无法确定来源分组' : '中央分支不存在同名资产',
    }
  }

  async detail(selection: AssetSelection): Promise<AssetDetail> {
    const asset = await this.getCatalogAsset(selection)
    const coreAsset = this.coreCatalog.get(keyFor(selection.source, selection.assetId)) ?? asset as unknown as CoreAsset
    return AssetDetailSchema.parse(await this.core.readAssetDetail(coreAsset))
  }
  async statuses(selection: AssetSelection): Promise<Array<{ projectId: string | null; agentId: string; path: string; method: 'copy' | 'symlink' | null; status: DesktopStatus }>> {
    const installed = await this.getCatalogAsset(selection)
    const meta = this.metadata.get(keyFor(selection.source, selection.assetId))
    const scannedLocations = (this.locations.get(keyFor(selection.source, selection.assetId)) ?? []).filter(({ meta: locationMeta }) => selection.source.kind !== 'project' || locationMeta.projectId === selection.source.projectId)
    let central: AssetRecord | null = null
    let missingReason = '中央分支不存在同名资产'
    try {
      const match = this.findCentralAsset(installed, await this.scan({ kind: 'central' }))
      central = match.asset
      missingReason = match.reason
    } catch { /* report unknown below */ }
    if (!central) {
      const locations = scannedLocations.length > 0 ? scannedLocations.map(({ asset: location, meta: locationMeta }) => ({ projectId: locationMeta.projectId, agentId: locationMeta.agentId ?? '', path: location.path })) : [{ projectId: meta?.projectId ?? null, agentId: meta?.agentId ?? '', path: installed.path }]
      return Promise.all(locations.map(async (location) => ({ ...location, method: await this.installMethod(location.path), status: unknownStatus(missingReason) })))
    }

    const centralCoreAsset = this.coreCatalog.get(keyFor({ kind: 'central' }, central.id)) ?? central as unknown as CoreAsset
    const evaluate = async (location: { projectId: string | null; agentId: string; path: string }): Promise<{ projectId: string | null; agentId: string; path: string; method: 'copy' | 'symlink' | null; status: DesktopStatus }> => {
      const method = await this.installMethod(location.path)
      try { return { ...location, method, status: AssetStatusRecordSchema.parse(await this.core.evaluateAssetStatus(centralCoreAsset, location.path)) } }
      catch { return { ...location, method, status: unknownStatus('无法计算资产状态') } }
    }
    if (selection.source.kind !== 'central') {
      const locations = scannedLocations.length > 0 ? scannedLocations.map(({ asset: location, meta: locationMeta }) => ({ projectId: locationMeta.projectId, agentId: locationMeta.agentId ?? '', path: location.path })) : [{ projectId: meta?.projectId ?? null, agentId: meta?.agentId ?? '', path: installed.path }]
      const results: Array<{ projectId: string | null; agentId: string; path: string; method: 'copy' | 'symlink' | null; status: DesktopStatus }> = []
      let cursor = 0
      const worker = async () => { while (true) { const index = cursor++; if (index >= locations.length) return; results[index] = await evaluate(locations[index]!) } }
      await Promise.all(Array.from({ length: Math.min(8, locations.length) }, worker))
      return results
    }

    const state = await this.appStore.read()
    const locations: Array<{ projectId: string | null; agentId: string; path: string }> = []
    for (const agent of (await this.listAgents()).filter((entry) => entry.enabled)) {
      for (const type of [central.type] as const) {
        let globalRoot: string
        try { globalRoot = this.core.resolveAgentAssetRoot(agent as unknown as CoreAgent, 'global', homedir(), type) } catch {
          const base = resolve(agent.globalBaseDir); globalRoot = resolve(base, agent.assetDirs[type])
        }
        locations.push({ projectId: null, agentId: agent.id, path: join(globalRoot, central.name) })
        for (const project of state.projects) {
          let projectRoot: string
          try { projectRoot = this.core.resolveAgentAssetRoot(agent as unknown as CoreAgent, 'project', project.path, type) } catch {
            const base = agent.projectBaseDir.startsWith('/') ? agent.projectBaseDir : resolve(project.path, agent.projectBaseDir)
            projectRoot = resolve(base, agent.assetDirs[type])
          }
          locations.push({ projectId: project.id, agentId: agent.id, path: join(projectRoot, central.name) })
        }
      }
    }
    const results: Array<{ projectId: string | null; agentId: string; path: string; method: 'copy' | 'symlink' | null; status: DesktopStatus }> = []
    let cursor = 0
    const worker = async () => { while (true) { const index = cursor++; if (index >= locations.length) return; results[index] = await evaluate(locations[index]!) } }
    await Promise.all(Array.from({ length: Math.min(8, locations.length) }, worker))
    return results
  }

  async plan(request: OperationRequest): Promise<OperationPlan> {
    this.prunePlans()
    let sourceAsset = await this.getCatalogAsset(request.asset)
    let sourceSelection = request.asset
    if (request.kind === 'update' && request.asset.source.kind !== 'central') {
      const centralAssets = await this.scan({ kind: 'central' })
      const match = this.findCentralAsset(sourceAsset, centralAssets)
      if (!match.asset) throw new Error(match.reason)
      sourceAsset = match.asset
      sourceSelection = { source: { kind: 'central' }, assetId: match.asset.id }
    }
    const state = await this.appStore.read()
    const agent = (await this.listAgents()).find((item) => item.id === request.target.agentId)
    if (!agent) throw new Error(`unknown Agent id: ${request.target.agentId}`)
    const project = request.target.projectId ? state.projects.find((item) => item.id === request.target.projectId) : undefined
    if (request.target.scope === 'project' && !project) throw new Error('unknown project id')
    const projectRoot = project?.path ?? homedir()
    const targetRoot = this.core.resolveAgentAssetRoot(agent as unknown as CoreAgent, request.target.scope, projectRoot, sourceAsset.type)
    const repository = await this.resolveSource().catch(() => null)
    const coreSourceAsset = this.coreCatalog.get(keyFor(sourceSelection.source, sourceSelection.assetId)) ?? sourceAsset as unknown as CoreAsset
    const planned = await this.core.planOperation({ kind: request.kind, asset: coreSourceAsset, sourceBranch: this.selectedBranch ?? 'main', targetRoot, method: request.method, allowSymlink: repository?.allowSymlink ?? this.repository?.allowSymlink ?? true, allowedRoot: targetRoot }) as unknown as OperationPlan
    this.planned.set(planned.id, { plan: planned, controller: new AbortController(), createdAt: Date.now() })
    return planned
  }
  async execute(planId: string, options?: { signal?: AbortSignal; onProgress?: (progress: import('../../shared/ipc.js').OperationProgress) => void }): Promise<OperationResult> {
    this.prunePlans()
    const task = this.planned.get(planId)
    if (!task) throw new Error('unknown or expired plan id')
    const abortFromCaller = () => task.controller.abort()
    if (options?.signal?.aborted) task.controller.abort()
    else options?.signal?.addEventListener('abort', abortFromCaller, { once: true })
    try {
      return await this.core.executeOperation(task.plan as never, { signal: task.controller.signal, onProgress: options?.onProgress }) as unknown as OperationResult
    } finally {
      options?.signal?.removeEventListener('abort', abortFromCaller)
      this.planned.delete(planId)
    }
  }
  async cancel(planId: string, _options?: { signal?: AbortSignal }): Promise<void> {
    this.prunePlans()
    const task = this.planned.get(planId)
    if (!task) throw new Error('unknown or expired plan id')
    task.controller.abort()
    this.planned.delete(planId)
  }
  async planOperation(request: OperationRequest): Promise<OperationPlan> { return this.plan(request) }
  async executeOperation(planId: string, options?: { signal?: AbortSignal; onProgress?: (progress: import('../../shared/ipc.js').OperationProgress) => void }): Promise<OperationResult> { return this.execute(planId, options) }
  private prunePlans(): void {
    const now = Date.now()
    for (const [id, task] of this.planned) {
      if (now - task.createdAt >= this.planExpiryMs) {
        task.controller.abort()
        this.planned.delete(id)
      }
    }
  }
  async rescanAffected(_paths: string[]): Promise<void> {
    this.catalog.clear(); this.coreCatalog.clear(); this.metadata.clear(); this.locations.clear()
    await this.scan({ kind: 'central' }).catch(() => [])
    await this.scan({ kind: 'global' }).catch(() => [])
    const projects = await this.listProjects()
    for (const project of projects) await this.scan({ kind: 'project', projectId: project.id }).catch(() => [])
  }
}
