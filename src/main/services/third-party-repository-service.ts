import { randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { realpath, rm } from 'node:fs/promises'
import * as xcSkillsCore from 'xc-skills/core'
import { z } from 'zod'
import {
  AssetRecordSchema,
  ThirdPartyRepositoryInputSchema,
  ThirdPartyRepositorySchema,
  ThirdPartyRepositoryViewSchema,
  type AssetRecord,
  type ThirdPartyRepository,
  type ThirdPartyRepositoryInput,
  type ThirdPartySkillRoot,
  type ThirdPartyRepositoryView,
} from '../../shared/ipc.js'
import type { AppStore } from './app-store.js'

type CoreRepositorySource = {
  root: string
  branch: string
  commit: string
  kind: 'local-worktree' | 'branch-cache'
  allowSymlink: boolean
  stale: boolean
  cachedAt: string | null
}

export interface ThirdPartyCoreAdapter {
  normalizeRepositorySource(source: string): Promise<string>
  resolveDefaultBranch(config: { mode: 'remote'; remoteUrl: string }): Promise<string>
  resolveRepositorySource(
    config: { mode: 'remote'; remoteUrl: string; defaultBranch: string },
    branch: string,
    cacheRoot: string,
  ): Promise<CoreRepositorySource>
  detectRepositoryLayout(options: { root: string }): Promise<'catalog' | 'single-skill'>
  scanAssets(options: {
    root: string
    types: ['skills']
    layout: 'catalog' | 'single-skill'
    sourceName: string
    skillRoots?: ThirdPartySkillRoot[]
  }): Promise<unknown[]>
}

export type ResolvedThirdPartyRepository = {
  repository: ThirdPartyRepository
  root: string
  branch: string
  commit: string
  layout: 'catalog' | 'single-skill'
  stale: boolean
  cachedAt: string | null
  lastError: string | null
  assets: AssetRecord[]
  coreAssets: unknown[]
}

type LogLike = { write(level: string, message: string, context?: unknown): Promise<void> }
type ServiceOptions = {
  appStore: AppStore
  cacheRoot: string | (() => string | Promise<string>)
  core?: ThirdPartyCoreAdapter
  log?: LogLike
  idFactory?: () => string
  now?: () => Date
}

const defaultCore = xcSkillsCore as unknown as ThirdPartyCoreAdapter
const repositoryName = z.string().trim().min(1).max(200).refine((value) =>
  value !== '.'
  && value !== '..'
  && !value.includes('/')
  && !value.includes('\\')
  && !value.includes('..')
  && !/[\u0000-\u001f\u007f]/u.test(value),
'invalid repository name')

const isWithin = (parent: string, child: string): boolean => {
  const rel = relative(parent, child)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel))
}

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

const assertRemoteSource = (source: string): void => {
  if (/^[^/@\s]+@[^/:\s]+:.+$/u.test(source)) return
  let url: URL
  try { url = new URL(source) } catch { throw new Error('third-party repository must be a remote Git URL') }
  if (!['https:', 'ssh:'].includes(url.protocol)) throw new Error('third-party repository must use HTTPS or SSH')
  if (url.password || (url.protocol === 'https:' && url.username)) throw new Error('repository URL must not contain credentials')
}

const inferName = (source: string): string => {
  let path = source
  try { path = decodeURIComponent(new URL(source).pathname) } catch {
    const separator = source.indexOf(':')
    if (separator >= 0) path = source.slice(separator + 1)
  }
  const final = path.replace(/\/+$/u, '').split('/').filter(Boolean).at(-1) ?? ''
  return repositoryName.parse(final.replace(/\.git$/u, ''))
}

export class ThirdPartyRepositoryService {
  private readonly appStore: AppStore
  private readonly cacheRootProvider: ServiceOptions['cacheRoot']
  private readonly core: ThirdPartyCoreAdapter
  private readonly log?: LogLike
  private readonly idFactory: () => string
  private readonly now: () => Date
  private readonly snapshots = new Map<string, ResolvedThirdPartyRepository>()
  private readonly refreshes = new Map<string, Promise<ThirdPartyRepositoryView>>()

  constructor(options: ServiceOptions) {
    this.appStore = options.appStore
    this.cacheRootProvider = options.cacheRoot
    this.core = options.core ?? defaultCore
    this.log = options.log
    this.idFactory = options.idFactory ?? randomUUID
    this.now = options.now ?? (() => new Date())
  }

  private async managedRoot(): Promise<string> {
    const root = typeof this.cacheRootProvider === 'function'
      ? await this.cacheRootProvider()
      : this.cacheRootProvider
    return resolve(root, 'third-party')
  }

  private async cacheRoot(id: string): Promise<string> { return resolve(await this.managedRoot(), id) }

  private async assertUnique(url: string, branch: string, exceptId?: string): Promise<void> {
    if ((await this.appStore.listThirdPartyRepositories()).some((repository) =>
      repository.id !== exceptId && repository.url === url && repository.branch === branch)) {
      throw new Error('repository URL and branch are already registered')
    }
  }

  private async normalizedInput(input: ThirdPartyRepositoryInput): Promise<{
    url: string
    name: string
    branch: string
    skillRoots: ThirdPartySkillRoot[]
  }> {
    const parsed = ThirdPartyRepositoryInputSchema.parse(input)
    const url = await this.core.normalizeRepositorySource(parsed.url)
    assertRemoteSource(url)
    const branch = parsed.branch ?? await this.core.resolveDefaultBranch({ mode: 'remote', remoteUrl: url })
    return {
      url,
      branch,
      name: repositoryName.parse(parsed.name ?? inferName(url)),
      skillRoots: parsed.skillRoots ?? [],
    }
  }

  private async prepare(repository: ThirdPartyRepository): Promise<ResolvedThirdPartyRepository> {
    const config = { mode: 'remote' as const, remoteUrl: repository.url, defaultBranch: repository.branch }
    const source = await this.core.resolveRepositorySource(config, repository.branch, await this.cacheRoot(repository.id))
    const hasConfiguredRoots = repository.skillRoots.length > 0
    const layout = hasConfiguredRoots
      ? 'catalog' as const
      : await this.core.detectRepositoryLayout({ root: source.root })
    const coreAssets = await this.core.scanAssets({
      root: source.root,
      types: ['skills'],
      layout,
      sourceName: repository.name,
      ...(hasConfiguredRoots ? { skillRoots: repository.skillRoots } : {}),
    })
    const assets = coreAssets.map((asset) => AssetRecordSchema.parse(asset))
    if (assets.length === 0) throw new Error('repository contains no Skills')
    return {
      repository,
      root: source.root,
      branch: source.branch,
      commit: source.commit,
      layout,
      stale: source.stale,
      cachedAt: source.cachedAt,
      lastError: null,
      assets,
      coreAssets,
    }
  }

  private asView(snapshot: ResolvedThirdPartyRepository): ThirdPartyRepositoryView {
    return ThirdPartyRepositoryViewSchema.parse({
      ...snapshot.repository,
      skillCount: snapshot.assets.length,
      stale: snapshot.stale,
      cachedAt: snapshot.cachedAt,
      lastError: snapshot.lastError,
    })
  }

  private async removeOwnedCache(id: string): Promise<void> {
    const root = await this.cacheRoot(id)
    const managedRoot = await this.managedRoot()
    const canonicalManagedRoot = await realpath(managedRoot).catch(() => managedRoot)
    const canonicalRoot = await realpath(root).catch(() => root)
    if (canonicalRoot === canonicalManagedRoot || !isWithin(canonicalManagedRoot, canonicalRoot)) {
      throw new Error('repository cache is outside the managed cache root')
    }
    await rm(root, { recursive: true, force: true })
  }

  async list(): Promise<ThirdPartyRepositoryView[]> {
    const repositories = await this.appStore.listThirdPartyRepositories()
    return await Promise.all(repositories.map(async (repository) => {
      try { return this.asView(await this.resolve(repository.id)) } catch (error) {
        return ThirdPartyRepositoryViewSchema.parse({
          ...repository,
          skillCount: 0,
          stale: true,
          cachedAt: null,
          lastError: errorMessage(error),
        })
      }
    }))
  }

  invalidateSnapshots(): void {
    this.snapshots.clear()
  }

  async add(input: ThirdPartyRepositoryInput): Promise<ThirdPartyRepositoryView> {
    const normalized = await this.normalizedInput(input)
    await this.assertUnique(normalized.url, normalized.branch)
    const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/u).parse(this.idFactory())
    const createdAt = this.now().toISOString()
    const candidate = ThirdPartyRepositorySchema.parse({
      id,
      ...normalized,
      layout: 'catalog',
      createdAt,
      lastFetchedAt: null,
    })
    try {
      const prepared = await this.prepare(candidate)
      const repository = ThirdPartyRepositorySchema.parse({
        ...candidate,
        layout: prepared.layout,
        lastFetchedAt: prepared.stale ? null : prepared.cachedAt ?? this.now().toISOString(),
      })
      const snapshot = { ...prepared, repository, layout: repository.layout }
      await this.appStore.saveThirdPartyRepository(repository)
      this.snapshots.set(id, snapshot)
      return this.asView(snapshot)
    } catch (error) {
      await this.removeOwnedCache(id).catch(() => undefined)
      await this.log?.write('error', 'third-party repository add failed', { id, error: errorMessage(error) })
      throw error
    }
  }

  async update(id: string, input: ThirdPartyRepositoryInput): Promise<ThirdPartyRepositoryView> {
    const existing = (await this.appStore.listThirdPartyRepositories()).find((repository) => repository.id === id)
    if (!existing) throw new Error('unknown third-party repository id')
    const normalized = await this.normalizedInput(input)
    await this.assertUnique(normalized.url, normalized.branch, id)
    const candidate = ThirdPartyRepositorySchema.parse({ ...existing, ...normalized, lastFetchedAt: existing.lastFetchedAt })
    const prepared = await this.prepare(candidate)
    const repository = ThirdPartyRepositorySchema.parse({
      ...candidate,
      layout: prepared.layout,
      lastFetchedAt: prepared.stale ? existing.lastFetchedAt : prepared.cachedAt ?? this.now().toISOString(),
    })
    const snapshot = { ...prepared, repository, layout: repository.layout }
    await this.appStore.saveThirdPartyRepository(repository)
    this.snapshots.set(id, snapshot)
    return this.asView(snapshot)
  }

  async remove(id: string): Promise<void> {
    const repository = (await this.appStore.listThirdPartyRepositories()).find((entry) => entry.id === id)
    if (!repository) throw new Error('unknown third-party repository id')
    await this.removeOwnedCache(repository.id)
    await this.appStore.removeThirdPartyRepository(repository.id)
    this.snapshots.delete(repository.id)
  }

  async refresh(id: string): Promise<ThirdPartyRepositoryView> {
    const active = this.refreshes.get(id)
    if (active) return active
    const task = this.refreshNow(id).finally(() => {
      if (this.refreshes.get(id) === task) this.refreshes.delete(id)
    })
    this.refreshes.set(id, task)
    return task
  }

  private async refreshNow(id: string): Promise<ThirdPartyRepositoryView> {
    const repository = (await this.appStore.listThirdPartyRepositories()).find((entry) => entry.id === id)
    if (!repository) throw new Error('unknown third-party repository id')
    try {
      const prepared = await this.prepare(repository)
      const updated = ThirdPartyRepositorySchema.parse({
        ...repository,
        layout: prepared.layout,
        lastFetchedAt: prepared.stale ? repository.lastFetchedAt : prepared.cachedAt ?? this.now().toISOString(),
      })
      const snapshot = { ...prepared, repository: updated, layout: updated.layout }
      await this.appStore.saveThirdPartyRepository(updated)
      this.snapshots.set(id, snapshot)
      return this.asView(snapshot)
    } catch (error) {
      const previous = this.snapshots.get(id)
      await this.log?.write('error', 'third-party repository refresh failed', { id, error: errorMessage(error) })
      if (!previous) throw error
      const stale = { ...previous, stale: true, lastError: errorMessage(error) }
      this.snapshots.set(id, stale)
      return this.asView(stale)
    }
  }

  async resolve(id: string): Promise<ResolvedThirdPartyRepository> {
    const cached = this.snapshots.get(id)
    if (cached) return cached
    const repository = (await this.appStore.listThirdPartyRepositories()).find((entry) => entry.id === id)
    if (!repository) throw new Error('unknown third-party repository id')
    const snapshot = await this.prepare(repository)
    this.snapshots.set(id, snapshot)
    return snapshot
  }
}
