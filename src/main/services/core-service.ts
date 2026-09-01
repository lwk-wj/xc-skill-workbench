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
  DesktopState, InstallationSourceRecord, OperationPlan, OperationRequest, OperationResult, ProjectRecord, RepositoryBranch,
  RepositoryConfigInput, RepositoryConfigUpdateResult, RepositoryView, SourceSelection,
  ThirdPartyRepositoryInput, ThirdPartyRepositoryView, RelinkInstallationInput, SourceConflict,
} from '../../shared/ipc.js'
import {
  AssetRecordSchema, AssetDetailSchema, AssetStatusRecordSchema, XcSkillsConfigSchema,
} from '../../shared/ipc.js'
import type { AppStore } from './app-store.js'
import type { ThirdPartyRepositoryService } from './third-party-repository-service.js'

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
  thirdPartyRepositories?: ThirdPartyRepositoryService
}
type PlannedSourceSnapshot = {
  selection: SourceSelection
  asset: AssetRecord
  coreAsset: CoreAsset
  repositoryId: string | null
  repositoryName: string
  repositoryUrl: string | null
  commit: string | null
}
type PlannedTargetSnapshot = {
  scope: 'project' | 'global'
  projectId: string | null
  agentId: string
  targetPath: string
  previousInstallationId: string | null
}

const asDesktopAsset = (asset: unknown): AssetRecord => AssetRecordSchema.parse(asset)
const keyFor = (source: SourceSelection, id: string) => `${JSON.stringify(source)}:${id}`
const unknownStatus = (reason: string): DesktopStatus => AssetStatusRecordSchema.parse({
  status: 'unknown', updateAvailable: false, locallyModified: false, sourceHash: null, installedHash: null,
  sourceVersion: null, installedVersion: null, resolvedTarget: null, reason,
})
const sourceUnavailableStatus = (reason = '来源仓库不可用'): DesktopStatus => AssetStatusRecordSchema.parse({
  status: 'source_unavailable', updateAvailable: false, locallyModified: false, sourceHash: null, installedHash: null,
  sourceVersion: null, installedVersion: null, resolvedTarget: null, reason,
})

export class CoreService {
  private readonly appStore: AppStore
  private readonly configPath: string | undefined
  private readonly cacheRoot: string
  private readonly chooseDirectory: ChooseDirectory
  private readonly log?: CoreServiceOptions['log']
  private readonly thirdPartyRepositories?: ThirdPartyRepositoryService
  private readonly core: typeof import('xc-skills/core')
  private config: XcSkillsConfig | null = null
  private selectedBranch: string | null = null
  private repository: Awaited<ReturnType<typeof resolveRepositorySource>> | null = null
  private readonly catalog = new Map<string, AssetRecord>()
  private readonly coreCatalog = new Map<string, CoreAsset>()
  private readonly metadata = new Map<string, CatalogMeta>()
  private readonly locations = new Map<string, Array<{ asset: AssetRecord; meta: CatalogMeta }>>()
  private readonly planned = new Map<string, {
    plan: OperationPlan
    request: OperationRequest
    sourceSnapshot: PlannedSourceSnapshot | null
    targetSnapshot: PlannedTargetSnapshot
    controller: AbortController
    createdAt: number
    repositoryId: string | null
  }>()
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
    this.thirdPartyRepositories = options.thirdPartyRepositories
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

  private requireThirdPartyRepositories(): ThirdPartyRepositoryService {
    if (!this.thirdPartyRepositories) throw new Error('third-party repository service is not available')
    return this.thirdPartyRepositories
  }
  async listThirdPartyRepositories(): Promise<ThirdPartyRepositoryView[]> { return this.requireThirdPartyRepositories().list() }
  async addThirdPartyRepository(input: ThirdPartyRepositoryInput): Promise<ThirdPartyRepositoryView> { return this.requireThirdPartyRepositories().add(input) }
  async updateThirdPartyRepository(id: string, input: ThirdPartyRepositoryInput): Promise<ThirdPartyRepositoryView> {
    if (this.hasActiveRepositoryPlans(id)) throw new Error('repository is referenced by an active operation plan')
    return this.requireThirdPartyRepositories().update(id, input)
  }
  async removeThirdPartyRepository(id: string): Promise<void> {
    if (this.hasActiveRepositoryPlans(id)) throw new Error('repository is referenced by an active operation plan')
    return this.requireThirdPartyRepositories().remove(id)
  }
  async refreshThirdPartyRepository(id: string): Promise<ThirdPartyRepositoryView> { return this.requireThirdPartyRepositories().refresh(id) }
  hasActiveRepositoryPlans(repositoryId: string): boolean {
    this.prunePlans()
    return [...this.planned.values()].some((task) => task.repositoryId === repositoryId)
  }
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
    this.metadata.forEach((_value, key) => { if (key.startsWith(`${JSON.stringify(source)}:`)) this.metadata.delete(key) })
    this.locations.forEach((_value, key) => { if (key.startsWith(`${JSON.stringify(source)}:`)) this.locations.delete(key) })
    const result: AssetRecord[] = []
    if (source.kind === 'central') {
      const repo = await this.resolveSource()
      result.push(...await this.scanRoot(source, repo.root, null, null))
      return result
    }
    if (source.kind === 'third-party') {
      const repository = await this.requireThirdPartyRepositories().resolve(source.repositoryId)
      for (let index = 0; index < repository.assets.length; index += 1) {
        const asset = repository.assets[index]!
        const key = keyFor(source, asset.id)
        this.catalog.set(key, asset)
        this.coreCatalog.set(key, (repository.coreAssets[index] ?? asset) as CoreAsset)
        this.metadata.set(key, { source, projectId: null, agentId: null, method: null })
        result.push(asset)
      }
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
  private async resolveRecordedSource(record: InstallationSourceRecord): Promise<{ asset: AssetRecord; coreAsset: CoreAsset }> {
    if (record.source.kind === 'third-party') {
      const repository = await this.requireThirdPartyRepositories().resolve(record.source.repositoryId)
      const index = repository.assets.findIndex((asset) =>
        asset.type === record.asset.type && asset.group === record.asset.group && asset.name === record.asset.name)
      if (index < 0) throw new Error('recorded Skill no longer exists in its repository')
      return { asset: repository.assets[index]!, coreAsset: (repository.coreAssets[index] ?? repository.assets[index]) as CoreAsset }
    }
    const centralAssets = await this.scan({ kind: 'central' })
    const asset = centralAssets.find((candidate) =>
      candidate.type === record.asset.type && candidate.group === record.asset.group && candidate.name === record.asset.name)
    if (!asset) throw new Error('recorded Skill no longer exists in the central repository')
    return { asset, coreAsset: this.coreCatalog.get(keyFor({ kind: 'central' }, asset.id)) ?? asset as unknown as CoreAsset }
  }

  private async catalogTargetLocations(asset: AssetRecord): Promise<Array<{ projectId: string | null; agentId: string; path: string }>> {
    const state = await this.appStore.read()
    const locations: Array<{ projectId: string | null; agentId: string; path: string }> = []
    for (const agent of (await this.listAgents()).filter((entry) => entry.enabled)) {
      let globalRoot: string
      try { globalRoot = this.core.resolveAgentAssetRoot(agent as unknown as CoreAgent, 'global', homedir(), asset.type) } catch {
        globalRoot = resolve(agent.globalBaseDir, agent.assetDirs[asset.type])
      }
      locations.push({ projectId: null, agentId: agent.id, path: join(globalRoot, asset.name) })
      for (const project of state.projects) {
        let projectRoot: string
        try { projectRoot = this.core.resolveAgentAssetRoot(agent as unknown as CoreAgent, 'project', project.path, asset.type) } catch {
          const base = agent.projectBaseDir.startsWith('/') ? agent.projectBaseDir : resolve(project.path, agent.projectBaseDir)
          projectRoot = resolve(base, agent.assetDirs[asset.type])
        }
        locations.push({ projectId: project.id, agentId: agent.id, path: join(projectRoot, asset.name) })
      }
    }
    return locations
  }

  async statuses(selection: AssetSelection): Promise<Array<{ projectId: string | null; agentId: string; path: string; method: 'copy' | 'symlink' | null; status: DesktopStatus }>> {
    const selected = await this.getCatalogAsset(selection)
    const key = keyFor(selection.source, selection.assetId)
    const meta = this.metadata.get(key)
    const evaluate = async (coreAsset: CoreAsset, location: { projectId: string | null; agentId: string; path: string }) => {
      const method = await this.installMethod(location.path)
      try { return { ...location, method, status: AssetStatusRecordSchema.parse(await this.core.evaluateAssetStatus(coreAsset, location.path)) } }
      catch { return { ...location, method, status: unknownStatus('无法计算资产状态') } }
    }

    if (selection.source.kind === 'central' || selection.source.kind === 'third-party') {
      const coreAsset = this.coreCatalog.get(key) ?? selected as unknown as CoreAsset
      const locations = await this.catalogTargetLocations(selected)
      return await Promise.all(locations.map((location) => evaluate(coreAsset, location)))
    }

    const scannedLocations = (this.locations.get(key) ?? [])
      .filter(({ meta: locationMeta }) => selection.source.kind !== 'project' || locationMeta.projectId === selection.source.projectId)
    const locations = scannedLocations.length > 0
      ? scannedLocations.map(({ asset, meta: locationMeta }) => ({ projectId: locationMeta.projectId, agentId: locationMeta.agentId ?? '', path: asset.path }))
      : [{ projectId: meta?.projectId ?? null, agentId: meta?.agentId ?? '', path: selected.path }]
    let legacyCentral: { asset: AssetRecord | null; reason: string } | null = null
    const results = [] as Array<{ projectId: string | null; agentId: string; path: string; method: 'copy' | 'symlink' | null; status: DesktopStatus }>
    for (const location of locations) {
      const method = await this.installMethod(location.path)
      const record = await this.appStore.findInstallationSourceByTarget({
        scope: selection.source.kind,
        projectId: selection.source.kind === 'project' ? selection.source.projectId : null,
        agentId: location.agentId,
        targetPath: location.path,
      })
      if (record) {
        try {
          const source = await this.resolveRecordedSource(record)
          results.push(await evaluate(source.coreAsset, location))
        } catch {
          results.push({ ...location, method, status: sourceUnavailableStatus() })
        }
        continue
      }
      if (!legacyCentral) {
        try { legacyCentral = this.findCentralAsset(selected, await this.scan({ kind: 'central' })) }
        catch { legacyCentral = { asset: null, reason: '中央分支不存在同名资产' } }
      }
      if (!legacyCentral.asset) {
        results.push({ ...location, method, status: unknownStatus(legacyCentral.reason) })
        continue
      }
      const coreAsset = this.coreCatalog.get(keyFor({ kind: 'central' }, legacyCentral.asset.id)) ?? legacyCentral.asset as unknown as CoreAsset
      results.push(await evaluate(coreAsset, location))
    }
    return results
  }

  async relinkInstallation(input: RelinkInstallationInput): Promise<void> {
    const record = (await this.appStore.listInstallationSources()).find((entry) => entry.id === input.installationId)
    if (!record) throw new Error('unknown installation source id')
    const repository = await this.requireThirdPartyRepositories().resolve(input.repositoryId)
    const index = repository.assets.findIndex((asset) => asset.id === input.assetId)
    if (index < 0) throw new Error('unknown repository asset id')
    const asset = repository.assets[index]!
    if (asset.type !== 'skills') throw new Error('only Skills can be relinked')
    const coreAsset = (repository.coreAssets[index] ?? asset) as CoreAsset
    const status = AssetStatusRecordSchema.parse(await this.core.evaluateAssetStatus(coreAsset, record.targetPath))
    if (!status.sourceHash || status.sourceHash !== status.installedHash) {
      throw new Error('installed content differs from the selected source; update or replace it instead')
    }
    await this.appStore.upsertInstallationSource({
      ...record,
      asset: { type: 'skills', group: asset.group, name: asset.name },
      source: {
        kind: 'third-party',
        repositoryId: repository.repository.id,
        repositoryName: repository.repository.name,
        repositoryUrl: repository.repository.url,
      },
      installedCommit: repository.commit,
      installedHash: status.installedHash,
    })
  }

  private async operationTarget(request: OperationRequest, asset: AssetRecord): Promise<{
    targetRoot: string
    targetPath: string
    projectId: string | null
  }> {
    const state = await this.appStore.read()
    const agent = (await this.listAgents()).find((item) => item.id === request.target.agentId)
    if (!agent) throw new Error(`unknown Agent id: ${request.target.agentId}`)
    const project = request.target.projectId ? state.projects.find((item) => item.id === request.target.projectId) : undefined
    if (request.target.scope === 'project' && !project) throw new Error('unknown project id')
    const projectRoot = project?.path ?? homedir()
    const targetRoot = this.core.resolveAgentAssetRoot(agent as unknown as CoreAgent, request.target.scope, projectRoot, asset.type)
    const rawTargetPath = join(targetRoot, asset.name)
    const targetPath = await import('node:fs/promises').then(({ realpath }) => realpath(rawTargetPath).catch(() => resolve(rawTargetPath)))
    return { targetRoot, targetPath, projectId: project?.id ?? null }
  }

  private sameSource(record: InstallationSourceRecord, requested: SourceConflict['requested']): boolean {
    if (record.source.kind === 'central') return requested.kind === 'central'
    return requested.kind === 'third-party' && record.source.repositoryId === requested.repositoryId
  }

  private async requestedSourceParty(source: SourceSelection): Promise<SourceConflict['requested']> {
    if (source.kind === 'third-party') {
      const repository = await this.requireThirdPartyRepositories().resolve(source.repositoryId)
      return { kind: 'third-party', repositoryId: source.repositoryId, label: repository.repository.name }
    }
    return { kind: 'central', repositoryId: null, label: '中央仓库' }
  }

  async inspectSourceConflict(request: OperationRequest): Promise<SourceConflict | null> {
    if (request.kind !== 'install' && request.kind !== 'update') return null
    const asset = await this.getCatalogAsset(request.asset)
    const target = await this.operationTarget(request, asset)
    const record = await this.appStore.findInstallationSourceByTarget({
      scope: request.target.scope,
      projectId: target.projectId,
      agentId: request.target.agentId,
      targetPath: target.targetPath,
    })
    const requested = await this.requestedSourceParty(request.asset.source)
    if (record && this.sameSource(record, requested)) return null
    if (record) {
      return {
        targetPath: target.targetPath,
        existing: record.source.kind === 'central'
          ? { kind: 'central', repositoryId: null, label: record.source.repositoryName }
          : { kind: 'third-party', repositoryId: record.source.repositoryId, label: record.source.repositoryName },
        requested,
      }
    }
    try {
      await lstat(target.targetPath)
      return { targetPath: target.targetPath, existing: { kind: 'untracked', repositoryId: null, label: '未登记的现有内容' }, requested }
    } catch { return null }
  }

  async plan(request: OperationRequest): Promise<OperationPlan> {
    this.prunePlans()
    let sourceAsset = await this.getCatalogAsset(request.asset)
    let sourceSelection = request.asset
    let target = await this.operationTarget(request, sourceAsset)
    const previous = await this.appStore.findInstallationSourceByTarget({ scope: request.target.scope, projectId: target.projectId, agentId: request.target.agentId, targetPath: target.targetPath })
    if (request.kind === 'update' && (request.asset.source.kind === 'project' || request.asset.source.kind === 'global')) {
      if (previous) {
        const recorded = await this.resolveRecordedSource(previous)
        sourceAsset = recorded.asset
        sourceSelection = previous.source.kind === 'third-party'
          ? { source: { kind: 'third-party', repositoryId: previous.source.repositoryId }, assetId: recorded.asset.id }
          : { source: { kind: 'central' }, assetId: recorded.asset.id }
      } else {
        const match = this.findCentralAsset(sourceAsset, await this.scan({ kind: 'central' }))
        if (!match.asset) throw new Error(match.reason)
        sourceAsset = match.asset
        sourceSelection = { source: { kind: 'central' }, assetId: match.asset.id }
      }
      target = await this.operationTarget(request, sourceAsset)
    }
    const conflict = await this.inspectSourceConflict({ ...request, asset: sourceSelection })
    if (conflict && !request.replaceExistingSource) throw new Error(`ENTRY_CONFLICT: ${conflict.existing.label} -> ${conflict.requested.label}`)
    const thirdParty = sourceSelection.source.kind === 'third-party'
      ? await this.requireThirdPartyRepositories().resolve(sourceSelection.source.repositoryId)
      : null
    const centralRepository = thirdParty ? null : await this.resolveSource().catch(() => null)
    const coreSourceAsset = this.coreCatalog.get(keyFor(sourceSelection.source, sourceSelection.assetId))
      ?? (thirdParty?.coreAssets[thirdParty.assets.findIndex((asset) => asset.id === sourceSelection.assetId)] as CoreAsset | undefined)
      ?? sourceAsset as unknown as CoreAsset
    const plannedRaw = await this.core.planOperation({
      kind: request.kind,
      asset: coreSourceAsset,
      sourceBranch: thirdParty?.branch ?? this.selectedBranch ?? 'main',
      targetRoot: target.targetRoot,
      method: thirdParty && (request.kind === 'install' || request.kind === 'update') ? 'copy' : request.method,
      allowSymlink: thirdParty ? false : centralRepository?.allowSymlink ?? this.repository?.allowSymlink ?? true,
      allowedRoot: target.targetRoot,
      overwriteModified: request.overwriteModified || request.replaceExistingSource,
    }) as unknown as OperationPlan
    const planned = conflict && request.replaceExistingSource
      ? { ...plannedRaw, warnings: [...plannedRaw.warnings, `将替换 ${conflict.existing.label} 的现有来源`] }
      : plannedRaw
    const sourceSnapshot: PlannedSourceSnapshot | null = request.kind === 'install' || request.kind === 'update'
      ? {
          selection: sourceSelection.source,
          asset: sourceAsset,
          coreAsset: coreSourceAsset,
          repositoryId: thirdParty?.repository.id ?? null,
          repositoryName: thirdParty?.repository.name ?? '中央仓库',
          repositoryUrl: thirdParty?.repository.url ?? null,
          commit: thirdParty?.commit ?? ((centralRepository as { commit?: string } | null)?.commit ?? null),
        }
      : null
    this.planned.set(planned.id, {
      plan: planned,
      request,
      sourceSnapshot,
      targetSnapshot: {
        scope: request.target.scope,
        projectId: target.projectId,
        agentId: request.target.agentId,
        targetPath: planned.targetPath,
        previousInstallationId: previous?.id ?? null,
      },
      controller: new AbortController(),
      createdAt: Date.now(),
      repositoryId: thirdParty?.repository.id ?? null,
    })
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
      const result = await this.core.executeOperation(task.plan as never, { signal: task.controller.signal, onProgress: options?.onProgress }) as unknown as OperationResult
      if (result.status !== 'completed') return result
      try {
        if ((task.request.kind === 'install' || task.request.kind === 'update') && task.sourceSnapshot) {
          const status = AssetStatusRecordSchema.parse(await this.core.evaluateAssetStatus(task.sourceSnapshot.coreAsset, task.targetSnapshot.targetPath))
          if (!status.installedHash) throw new Error('installed target hash is unavailable')
          await this.appStore.upsertInstallationSource({
            id: task.targetSnapshot.previousInstallationId ?? randomUUID(),
            scope: task.targetSnapshot.scope,
            projectId: task.targetSnapshot.projectId,
            agentId: task.targetSnapshot.agentId,
            targetPath: task.targetSnapshot.targetPath,
            asset: { type: 'skills', group: task.sourceSnapshot.asset.group, name: task.sourceSnapshot.asset.name },
            source: task.sourceSnapshot.repositoryId
              ? { kind: 'third-party', repositoryId: task.sourceSnapshot.repositoryId, repositoryName: task.sourceSnapshot.repositoryName, repositoryUrl: task.sourceSnapshot.repositoryUrl! }
              : { kind: 'central', repositoryId: null, repositoryName: task.sourceSnapshot.repositoryName, repositoryUrl: null },
            installedCommit: task.sourceSnapshot.commit,
            installedHash: status.installedHash,
          })
        } else if (task.request.kind === 'uninstall' && task.targetSnapshot.previousInstallationId) {
          await this.appStore.removeInstallationSource(task.targetSnapshot.previousInstallationId)
        }
      } catch (error) {
        await this.log?.write('error', 'operation completed but provenance update failed', { planId, targetPath: task.targetSnapshot.targetPath, error: error instanceof Error ? error.message : String(error) })
        return { ...result, status: 'needs_attention', residualPaths: [...new Set([...result.residualPaths, task.targetSnapshot.targetPath])] }
      }
      return result
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
