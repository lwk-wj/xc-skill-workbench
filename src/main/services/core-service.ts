import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
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
  RepositoryView, SourceSelection,
} from '../../shared/ipc.js'
import { AssetRecordSchema, AssetDetailSchema, AssetStatusRecordSchema } from '../../shared/ipc.js'
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
  private readonly metadata = new Map<string, CatalogMeta>()
  private readonly locations = new Map<string, Array<{ asset: AssetRecord; meta: CatalogMeta }>>()

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
    return [...builtins, ...state.customAgents]
  }
  async saveCustomAgent(agent: AgentDefinition): Promise<AgentDefinition[]> { return this.appStore.addCustomAgent(agent) }
  async removeCustomAgent(id: string): Promise<AgentDefinition[]> { return this.appStore.removeCustomAgent(id) }

  async getConfig(): Promise<XcSkillsConfig> { return this.ensureConfig() }
  async listBranches(): Promise<RepositoryBranch[]> { return this.core.listBranches(await this.ensureConfig()) }
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
        const asset = asDesktopAsset(agentId ? { ...raw, agentId } : raw)
        const key = keyFor(source, asset.id)
        this.catalog.set(key, asset)
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
  async detail(selection: AssetSelection): Promise<AssetDetail> {
    const asset = await this.getCatalogAsset(selection)
    return AssetDetailSchema.parse(await this.core.readAssetDetail(asset as unknown as CoreAsset))
  }
  async statuses(selection: AssetSelection): Promise<Array<{ projectId: string | null; agentId: string; path: string; method: null; status: DesktopStatus }>> {
    const installed = await this.getCatalogAsset(selection)
    const meta = this.metadata.get(keyFor(selection.source, selection.assetId))
    const scannedLocations = (this.locations.get(keyFor(selection.source, selection.assetId)) ?? []).filter(({ meta: locationMeta }) => selection.source.kind !== 'project' || locationMeta.projectId === selection.source.projectId)
    let central: AssetRecord | undefined
    try { central = (await this.scan({ kind: 'central' })).find((candidate) => candidate.type === installed.type && candidate.group === installed.group && candidate.name === installed.name) } catch { /* report unknown below */ }
    if (!central) {
      const locations = scannedLocations.length > 0 ? scannedLocations.map(({ asset: location, meta: locationMeta }) => ({ projectId: locationMeta.projectId, agentId: locationMeta.agentId ?? '', path: location.path })) : [{ projectId: meta?.projectId ?? null, agentId: meta?.agentId ?? '', path: installed.path }]
      return locations.map((location) => ({ ...location, method: null as null, status: unknownStatus('中央分支不存在同名资产') }))
    }

    const evaluate = async (location: { projectId: string | null; agentId: string; path: string }): Promise<{ projectId: string | null; agentId: string; path: string; method: null; status: DesktopStatus }> => {
      try { return { ...location, method: null, status: AssetStatusRecordSchema.parse(await this.core.evaluateAssetStatus(central as unknown as CoreAsset, location.path)) } }
      catch { return { ...location, method: null, status: unknownStatus('无法计算资产状态') } }
    }
    if (selection.source.kind !== 'central') {
      const locations = scannedLocations.length > 0 ? scannedLocations.map(({ asset: location, meta: locationMeta }) => ({ projectId: locationMeta.projectId, agentId: locationMeta.agentId ?? '', path: location.path })) : [{ projectId: meta?.projectId ?? null, agentId: meta?.agentId ?? '', path: installed.path }]
      const results: Array<{ projectId: string | null; agentId: string; path: string; method: null; status: DesktopStatus }> = []
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
        locations.push({ projectId: null, agentId: agent.id, path: join(globalRoot, central.group, central.name) })
        for (const project of state.projects) {
          let projectRoot: string
          try { projectRoot = this.core.resolveAgentAssetRoot(agent as unknown as CoreAgent, 'project', project.path, type) } catch {
            const base = agent.projectBaseDir.startsWith('/') ? agent.projectBaseDir : resolve(project.path, agent.projectBaseDir)
            projectRoot = resolve(base, agent.assetDirs[type])
          }
          locations.push({ projectId: project.id, agentId: agent.id, path: join(projectRoot, central.group, central.name) })
        }
      }
    }
    const results: Array<{ projectId: string | null; agentId: string; path: string; method: null; status: DesktopStatus }> = []
    let cursor = 0
    const worker = async () => { while (true) { const index = cursor++; if (index >= locations.length) return; results[index] = await evaluate(locations[index]!) } }
    await Promise.all(Array.from({ length: Math.min(8, locations.length) }, worker))
    return results
  }

  async plan(request: OperationRequest): Promise<OperationPlan> {
    const sourceAsset = await this.getCatalogAsset(request.asset)
    const state = await this.appStore.read()
    const agent = (await this.listAgents()).find((item) => item.id === request.target.agentId)
    if (!agent) throw new Error(`unknown Agent id: ${request.target.agentId}`)
    const project = request.target.projectId ? state.projects.find((item) => item.id === request.target.projectId) : undefined
    if (request.target.scope === 'project' && !project) throw new Error('unknown project id')
    const projectRoot = project?.path ?? homedir()
    const targetRoot = this.core.resolveAgentAssetRoot(agent as unknown as CoreAgent, request.target.scope, projectRoot, sourceAsset.type)
    return this.core.planOperation({ kind: request.kind, asset: sourceAsset as unknown as CoreAsset, sourceBranch: this.selectedBranch ?? 'main', targetRoot, method: request.method, allowSymlink: this.repository?.allowSymlink ?? true, allowedRoot: targetRoot }) as unknown as OperationPlan
  }
  async execute(plan: OperationPlan): Promise<OperationResult> { return this.core.executeOperation(plan as never) as unknown as OperationResult }
}
