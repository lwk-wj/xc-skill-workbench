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
  ProjectRecord,
  ProjectRecordSchema,
  SourceSelection,
  SourceSelectionSchema,
  ThemePreference,
  ThemePreferenceSchema,
  WindowBounds,
  WindowBoundsSchema,
} from '../../shared/ipc.js'

const isWithin = (parent: string, child: string): boolean => {
  const rel = relative(parent, child)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel))
}

export class AppStore {
  private readonly absoluteFilePath: string

  constructor(filePath: string) {
    this.absoluteFilePath = resolve(filePath)
  }

  async read(): Promise<DesktopState> {
    try {
      const raw = await readFile(this.absoluteFilePath, 'utf8')
      const state = DesktopStateSchema.parse(JSON.parse(raw))
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
      return { ...state, projects: canonicalProjects }
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
      if (state.customAgents.some((entry) => entry.id === normalized.id)) throw new Error('Agent id already exists')
      return { ...state, customAgents: [...state.customAgents, normalized] }
    })
    return next.customAgents
  }

  async removeCustomAgent(id: string): Promise<AgentDefinition[]> {
    const parsed = z.string().min(1).parse(id)
    return (await this.update((state) => ({ ...state, customAgents: state.customAgents.filter((agent) => agent.id !== parsed) }))).customAgents
  }

  async setTheme(theme: ThemePreference): Promise<void> {
    const parsed = ThemePreferenceSchema.parse(theme)
    await this.update((state) => ({ ...state, theme: parsed }))
  }

  async getTheme(): Promise<ThemePreference> { return (await this.read()).theme }

  async setLastSource(source: SourceSelection): Promise<void> {
    const parsed = SourceSelectionSchema.parse(source)
    await this.update((state) => ({ ...state, lastSource: parsed }))
  }

  async getLastSource(): Promise<SourceSelection> { return (await this.read()).lastSource }

  async setWindowBounds(bounds: WindowBounds | null): Promise<void> {
    const parsed = bounds === null ? null : WindowBoundsSchema.parse(bounds)
    await this.update((state) => ({ ...state, windowBounds: parsed }))
  }

  async getWindowBounds(): Promise<WindowBounds | null> { return (await this.read()).windowBounds }
}
