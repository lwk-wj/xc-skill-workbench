import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  AgentDefinition,
  AgentDefinitionSchema,
  DesktopState,
  DesktopStateDefaults,
  DesktopStateSchema,
  DesktopStateV1Schema,
  DesktopStateV2Schema,
  InstallationSourceRecord,
  InstallationSourceRecordSchema,
  ProjectRecord,
  ProjectRecordSchema,
  SourceSelection,
  SourceSelectionSchema,
  ThirdPartyRepository,
  ThirdPartyRepositorySchema,
  ThemePreference,
  ThemePreferenceSchema,
  WindowBounds,
  WindowBoundsSchema,
} from '../../shared/ipc.js'

const isWithin = (parent: string, child: string): boolean => {
  const rel = relative(parent, child)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel))
}

const installationTargetKey = (record: Pick<InstallationSourceRecord, 'scope' | 'projectId' | 'agentId' | 'targetPath'>): string =>
  JSON.stringify([record.scope, record.projectId, record.agentId, record.targetPath])

const logicalTargetPath = async (value: string): Promise<string> => {
  const absolute = resolve(value)
  const missingParents: string[] = []
  let cursor = dirname(absolute)
  let canonicalParent: string
  while (true) {
    try {
      canonicalParent = await realpath(cursor)
      break
    } catch {
      const parent = dirname(cursor)
      if (parent === cursor) {
        canonicalParent = resolve(cursor)
        break
      }
      missingParents.unshift(basename(cursor))
      cursor = parent
    }
  }
  return join(canonicalParent, ...missingParents, basename(absolute))
}

export class AppStore {
  private readonly absoluteFilePath: string

  constructor(filePath: string) {
    this.absoluteFilePath = resolve(filePath)
  }

  async read(): Promise<DesktopState> {
    try {
      const raw = await readFile(this.absoluteFilePath, 'utf8')
      const parsed = z.union([DesktopStateSchema, DesktopStateV2Schema, DesktopStateV1Schema]).parse(JSON.parse(raw))
      const state: DesktopState = parsed.version === 1
        ? {
            ...parsed,
            version: 3,
            thirdPartyRepositories: [],
            legacyInstallationSources: [],
          }
        : parsed.version === 2
          ? {
              version: 3,
              projects: parsed.projects,
              customAgents: parsed.customAgents,
              agentEnabled: parsed.agentEnabled,
              theme: parsed.theme,
              lastSource: parsed.lastSource,
              windowBounds: parsed.windowBounds,
              thirdPartyRepositories: parsed.thirdPartyRepositories,
              legacyInstallationSources: parsed.installationSources,
            }
          : parsed
      const ids = new Set<string>()
      const paths = new Set<string>()
      const canonicalProjects: ProjectRecord[] = []
      const canonicalParent = await realpath(dirname(this.absoluteFilePath)).catch(() => dirname(this.absoluteFilePath))
      const canonicalStatePath = join(canonicalParent, basename(this.absoluteFilePath))
      for (const project of state.projects) {
        const canonical = await realpath(project.path).catch(() => resolve(project.path))
        if (isWithin(canonical, canonicalStatePath)) throw new Error('state file must not be inside a configured project')
        if (ids.has(project.id) || paths.has(canonical)) throw new Error('state contains duplicate project')
        ids.add(project.id)
        paths.add(canonical)
        canonicalProjects.push({ ...project, path: canonical })
      }
      const agentIds = new Set<string>()
      for (const agent of state.customAgents) {
        if (agentIds.has(agent.id)) throw new Error('state contains duplicate Agent')
        agentIds.add(agent.id)
      }
      const repositoryIds = new Set<string>()
      const repositorySources = new Set<string>()
      for (const repository of state.thirdPartyRepositories) {
        const sourceKey = JSON.stringify([repository.url, repository.branch])
        if (repositoryIds.has(repository.id)) throw new Error('state contains duplicate repository id')
        if (repositorySources.has(sourceKey)) throw new Error('state contains duplicate repository source')
        repositoryIds.add(repository.id)
        repositorySources.add(sourceKey)
      }
      const installationIds = new Set<string>()
      const installationTargets = new Set<string>()
      const canonicalInstallations: InstallationSourceRecord[] = []
      for (const record of state.legacyInstallationSources) {
        const targetPath = await logicalTargetPath(record.targetPath)
        const normalized = { ...record, targetPath }
        const targetKey = installationTargetKey(normalized)
        if (installationIds.has(record.id)) throw new Error('state contains duplicate installation source id')
        if (installationTargets.has(targetKey)) throw new Error('state contains duplicate installation target')
        installationIds.add(record.id)
        installationTargets.add(targetKey)
        canonicalInstallations.push(normalized)
      }
      const lastSource = state.lastSource.kind === 'third-party'
        && !repositoryIds.has(state.lastSource.repositoryId)
        ? { kind: 'central' as const }
        : state.lastSource
      return {
        ...state,
        projects: canonicalProjects,
        legacyInstallationSources: canonicalInstallations,
        lastSource,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(DesktopStateDefaults)
      if (error instanceof SyntaxError || error instanceof z.ZodError) throw error
      throw error
    }
  }

  private async write(state: DesktopState): Promise<void> {
    const validated = DesktopStateSchema.parse(state)
    const canonicalParent = await realpath(dirname(this.absoluteFilePath)).catch(() => dirname(this.absoluteFilePath))
    const canonicalStatePath = join(canonicalParent, basename(this.absoluteFilePath))
    for (const project of validated.projects) {
      if (isWithin(project.path, canonicalStatePath)) {
        throw new Error('state file must not be inside a configured project')
      }
    }
    const parent = dirname(this.absoluteFilePath)
    await mkdir(parent, { recursive: true })
    const temp = `${this.absoluteFilePath}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, `${JSON.stringify(validated, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
      await rename(temp, this.absoluteFilePath)
    } finally {
      await rm(temp, { force: true }).catch(() => undefined)
    }
  }

  private async update(mutator: (state: DesktopState) => DesktopState): Promise<DesktopState> {
    const next = mutator(await this.read())
    await this.write(next)
    return next
  }

  async addProject(input: ProjectRecord): Promise<ProjectRecord> {
    const parsed = ProjectRecordSchema.parse(input)
    const canonical = await realpath(parsed.path)
    const project = { ...parsed, path: canonical }
    await this.update((state) => {
      if (state.projects.some((entry) => entry.path === canonical)) throw new Error('project path already exists')
      if (state.projects.some((entry) => entry.id === project.id)) throw new Error('project id already exists')
      return { ...state, projects: [...state.projects, project] }
    })
    return project
  }

  async removeProject(id: string): Promise<void> {
    const parsed = z.string().min(1).parse(id)
    await this.update((state) => ({ ...state, projects: state.projects.filter((project) => project.id !== parsed) }))
  }

  async addCustomAgent(agent: AgentDefinition): Promise<AgentDefinition[]> {
    const parsed = AgentDefinitionSchema.parse(agent)
    const canonicalize = async (value: string): Promise<string> => realpath(value).catch(() => resolve(value))
    const normalized = { ...parsed, projectBaseDir: await canonicalize(parsed.projectBaseDir), globalBaseDir: await canonicalize(parsed.globalBaseDir), assetDirs: { skills: await canonicalize(parsed.assetDirs.skills), rules: await canonicalize(parsed.assetDirs.rules), workflows: await canonicalize(parsed.assetDirs.workflows) } }
    const next = await this.update((state) => {
      const existing = state.customAgents.findIndex((entry) => entry.id === normalized.id)
      if (existing >= 0) {
        if (!state.customAgents[existing]!.builtIn && !normalized.builtIn) throw new Error('Agent id already exists')
        const customAgents = [...state.customAgents]
        customAgents[existing] = normalized
        return { ...state, customAgents }
      }
      return { ...state, customAgents: [...state.customAgents, normalized] }
    })
    return next.customAgents
  }

  async removeCustomAgent(id: string): Promise<AgentDefinition[]> {
    const parsed = z.string().min(1).parse(id)
    return (await this.update((state) => ({ ...state, customAgents: state.customAgents.filter((agent) => agent.id !== parsed) }))).customAgents
  }

  async setAgentEnabled(id: string, enabled: boolean): Promise<void> {
    const parsedId = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/).parse(id)
    const parsedEnabled = z.boolean().parse(enabled)
    await this.update((state) => ({
      ...state,
      agentEnabled: { ...state.agentEnabled, [parsedId]: parsedEnabled },
    }))
  }

  async setTheme(theme: ThemePreference): Promise<void> {
    const parsed = ThemePreferenceSchema.parse(theme)
    await this.update((state) => ({ ...state, theme: parsed }))
  }

  async getTheme(): Promise<ThemePreference> { return (await this.read()).theme }

  async setLastSource(source: SourceSelection): Promise<void> {
    const parsed = SourceSelectionSchema.parse(source)
    await this.update((state) => {
      if (parsed.kind === 'third-party' && !state.thirdPartyRepositories.some((repository) => repository.id === parsed.repositoryId)) {
        throw new Error('unknown third-party repository id')
      }
      return { ...state, lastSource: parsed }
    })
  }

  async getLastSource(): Promise<SourceSelection> { return (await this.read()).lastSource }

  async setWindowBounds(bounds: WindowBounds | null): Promise<void> {
    const parsed = bounds === null ? null : WindowBoundsSchema.parse(bounds)
    await this.update((state) => ({ ...state, windowBounds: parsed }))
  }

  async getWindowBounds(): Promise<WindowBounds | null> { return (await this.read()).windowBounds }

  async listThirdPartyRepositories(): Promise<ThirdPartyRepository[]> {
    return (await this.read()).thirdPartyRepositories
  }

  async saveThirdPartyRepository(repository: ThirdPartyRepository): Promise<ThirdPartyRepository[]> {
    const parsed = ThirdPartyRepositorySchema.parse(repository)
    return (await this.update((state) => {
      const duplicate = state.thirdPartyRepositories.find((entry) =>
        entry.id !== parsed.id && entry.url === parsed.url && entry.branch === parsed.branch)
      if (duplicate) throw new Error('duplicate repository source')
      const index = state.thirdPartyRepositories.findIndex((entry) => entry.id === parsed.id)
      if (index < 0) return { ...state, thirdPartyRepositories: [...state.thirdPartyRepositories, parsed] }
      const thirdPartyRepositories = [...state.thirdPartyRepositories]
      thirdPartyRepositories[index] = parsed
      return { ...state, thirdPartyRepositories }
    })).thirdPartyRepositories
  }

  async removeThirdPartyRepository(id: string): Promise<void> {
    const parsed = z.string().min(1).parse(id)
    await this.update((state) => ({
      ...state,
      thirdPartyRepositories: state.thirdPartyRepositories.filter((repository) => repository.id !== parsed),
      lastSource: state.lastSource.kind === 'third-party' && state.lastSource.repositoryId === parsed
        ? { kind: 'central' }
        : state.lastSource,
    }))
  }

  async listInstallationSources(): Promise<InstallationSourceRecord[]> {
    return (await this.read()).legacyInstallationSources
  }

  async upsertInstallationSource(record: InstallationSourceRecord): Promise<void> {
    const parsed = InstallationSourceRecordSchema.parse(record)
    const targetPath = await logicalTargetPath(parsed.targetPath)
    const normalized = { ...parsed, targetPath }
    await this.update((state) => {
      const targetKey = installationTargetKey(normalized)
      if (state.legacyInstallationSources.some((entry) => entry.id !== normalized.id && installationTargetKey(entry) === targetKey)) {
        throw new Error('duplicate installation target')
      }
      const index = state.legacyInstallationSources.findIndex((entry) => entry.id === normalized.id)
      if (index < 0) return { ...state, legacyInstallationSources: [...state.legacyInstallationSources, normalized] }
      const legacyInstallationSources = [...state.legacyInstallationSources]
      legacyInstallationSources[index] = normalized
      return { ...state, legacyInstallationSources }
    })
  }

  async removeInstallationSource(id: string): Promise<void> {
    const parsed = z.string().min(1).parse(id)
    await this.update((state) => ({
      ...state,
      legacyInstallationSources: state.legacyInstallationSources.filter((record) => record.id !== parsed),
    }))
  }

  async findInstallationSourceByTarget(input: Pick<InstallationSourceRecord, 'scope' | 'projectId' | 'agentId' | 'targetPath'>): Promise<InstallationSourceRecord | null> {
    const targetPath = await logicalTargetPath(input.targetPath)
    const key = installationTargetKey({ ...input, targetPath })
    return (await this.read()).legacyInstallationSources.find((record) => installationTargetKey(record) === key) ?? null
  }
}
