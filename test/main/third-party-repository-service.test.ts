import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../src/main/services/app-store.js'
import { ThirdPartyRepositoryService, type ThirdPartyCoreAdapter } from '../../src/main/services/third-party-repository-service.js'

const makeAsset = (root: string, name = 'demo') => ({
  id: '0123456789abcdef',
  type: 'skills' as const,
  name,
  group: '',
  path: join(root, name),
  entryPath: join(root, name, 'SKILL.md'),
  entryState: 'active' as const,
  description: 'Demo skill',
  version: null,
})

const fixture = async (overrides: Partial<ThirdPartyCoreAdapter> = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'xc-third-party-service-'))
  const cacheRoot = join(root, 'cache')
  const store = new AppStore(join(root, 'state.json'))
  const core: ThirdPartyCoreAdapter = {
    normalizeRepositorySource: async (url) => url.trim().replace('EXAMPLE.com', 'example.com'),
    resolveDefaultBranch: async () => 'trunk',
    resolveRepositorySource: async (_config, branch, repositoryCacheRoot) => {
      const checkout = join(repositoryCacheRoot, 'checkout')
      await mkdir(join(checkout, 'demo'), { recursive: true })
      await writeFile(join(checkout, 'demo', 'SKILL.md'), '# Demo\n')
      return {
        root: checkout,
        branch,
        commit: 'a'.repeat(40),
        kind: 'branch-cache',
        allowSymlink: false,
        stale: false,
        cachedAt: '2026-09-01T01:00:00.000Z',
      }
    },
    detectRepositoryLayout: async () => 'catalog',
    scanAssets: async ({ root: sourceRoot }) => [makeAsset(sourceRoot)],
    ...overrides,
  }
  const service = new ThirdPartyRepositoryService({
    appStore: store,
    cacheRoot,
    core,
    idFactory: () => 'repo-1',
    now: () => new Date('2026-09-01T02:00:00.000Z'),
  })
  return { root, cacheRoot, store, core, service }
}

describe('ThirdPartyRepositoryService', () => {
  it('adds a validated repository using its remote default branch', async () => {
    const { root, store, service } = await fixture()

    await expect(service.add({ url: ' ssh://git@EXAMPLE.com/team/skills.git ' })).resolves.toMatchObject({
      id: 'repo-1',
      name: 'skills',
      url: 'ssh://git@example.com/team/skills.git',
      branch: 'trunk',
      layout: 'catalog',
      skillCount: 1,
      stale: false,
    })
    await expect(store.listThirdPartyRepositories()).resolves.toMatchObject([{
      id: 'repo-1', name: 'skills', branch: 'trunk', layout: 'catalog',
    }])
    await rm(root, { recursive: true, force: true })
  })

  it('detects a root single-Skill repository and passes its display name as fallback', async () => {
    let receivedSourceName: string | undefined
    const { root, service } = await fixture({
      detectRepositoryLayout: async () => 'single-skill',
      scanAssets: async ({ root: sourceRoot, sourceName }) => {
        receivedSourceName = sourceName
        return [makeAsset(sourceRoot, sourceName)]
      },
    })

    await expect(service.add({ url: 'git@example.com:team/root-skill.git', name: 'Root Skill' }))
      .resolves.toMatchObject({ layout: 'single-skill', name: 'Root Skill', skillCount: 1 })
    expect(receivedSourceName).toBe('Root Skill')
    await rm(root, { recursive: true, force: true })
  })

  it('rejects normalized URL/branch duplicates and keeps an ID stable when editing', async () => {
    let nextId = 0
    const { root, store, core } = await fixture()
    const service = new ThirdPartyRepositoryService({
      appStore: store,
      cacheRoot: join(root, 'cache'),
      core,
      idFactory: () => `repo-${++nextId}`,
      now: () => new Date('2026-09-01T02:00:00.000Z'),
    })
    const first = await service.add({ url: 'https://EXAMPLE.com/team/skills.git', branch: 'main' })

    await expect(service.add({ url: 'https://example.com/team/skills.git', branch: 'main' }))
      .rejects.toThrow(/already registered/i)
    await expect(service.update(first.id, { url: 'https://example.com/team/new-skills.git', branch: 'release', name: 'New Skills' }))
      .resolves.toMatchObject({ id: first.id, name: 'New Skills', branch: 'release' })
    await rm(root, { recursive: true, force: true })
  })

  it('does not persist a repository when its first scan fails or is empty', async () => {
    const { root, store, service } = await fixture({ scanAssets: async () => [] })

    await expect(service.add({ url: 'https://example.com/empty.git' })).rejects.toThrow(/no Skills/i)
    await expect(store.listThirdPartyRepositories()).resolves.toEqual([])
    await rm(root, { recursive: true, force: true })
  })

  it('returns the previous snapshot as stale when refresh fails', async () => {
    let shouldFail = false
    const { root, service } = await fixture({
      resolveRepositorySource: async (_config, branch, repositoryCacheRoot) => {
        if (shouldFail) throw new Error('network unavailable')
        const checkout = join(repositoryCacheRoot, 'checkout')
        await mkdir(join(checkout, 'demo'), { recursive: true })
        await writeFile(join(checkout, 'demo', 'SKILL.md'), '# Demo\n')
        return { root: checkout, branch, commit: 'a'.repeat(40), kind: 'branch-cache', allowSymlink: false, stale: false, cachedAt: '2026-09-01T01:00:00.000Z' }
      },
    })
    const repository = await service.add({ url: 'https://example.com/team/skills.git' })
    shouldFail = true

    await expect(service.refresh(repository.id)).resolves.toMatchObject({
      id: repository.id,
      stale: true,
      lastError: 'network unavailable',
      skillCount: 1,
    })
    await rm(root, { recursive: true, force: true })
  })

  it('serializes same-repository refreshes while allowing different repositories in parallel', async () => {
    let id = 0
    let holdRefresh = false
    let release: (() => void) | undefined
    let active = 0
    let maxActive = 0
    const gate = new Promise<void>((resolve) => { release = resolve })
    const base = await fixture({
      resolveRepositorySource: async (_config, branch, repositoryCacheRoot) => {
        if (holdRefresh) {
          active += 1
          maxActive = Math.max(maxActive, active)
          await gate
          active -= 1
        }
        const checkout = join(repositoryCacheRoot, 'checkout')
        await mkdir(join(checkout, 'demo'), { recursive: true })
        await writeFile(join(checkout, 'demo', 'SKILL.md'), '# Demo\n')
        return { root: checkout, branch, commit: 'a'.repeat(40), kind: 'branch-cache', allowSymlink: false, stale: false, cachedAt: '2026-09-01T01:00:00.000Z' }
      },
    })
    const service = new ThirdPartyRepositoryService({
      appStore: base.store,
      cacheRoot: base.cacheRoot,
      core: base.core,
      idFactory: () => `repo-${++id}`,
    })
    const first = await service.add({ url: 'https://example.com/one.git' })
    const second = await service.add({ url: 'https://example.com/two.git' })
    holdRefresh = true

    const firstRefresh = service.refresh(first.id)
    const duplicateRefresh = service.refresh(first.id)
    const secondRefresh = service.refresh(second.id)
    await vi.waitFor(() => expect(maxActive).toBe(2))
    release?.()
    expect(await firstRefresh).toEqual(await duplicateRefresh)
    await secondRefresh
    expect(maxActive).toBe(2)
    await rm(base.root, { recursive: true, force: true })
  })

  it('refuses to remove a cache that resolves outside the managed root', async () => {
    const { root, cacheRoot, store, service } = await fixture()
    const outside = join(root, 'outside')
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'keep.txt'), 'keep')
    await store.saveThirdPartyRepository({
      id: 'repo-1', name: 'Unsafe', url: 'https://example.com/unsafe.git', branch: 'main', layout: 'catalog',
      createdAt: '2026-09-01T00:00:00.000Z', lastFetchedAt: null,
    })
    await mkdir(join(cacheRoot, 'third-party'), { recursive: true })
    await symlink(outside, join(cacheRoot, 'third-party', 'repo-1'))

    await expect(service.remove('repo-1')).rejects.toThrow(/managed cache root/i)
    await expect(store.listThirdPartyRepositories()).resolves.toHaveLength(1)
    await expect(writeFile(join(outside, 'keep.txt'), 'still here')).resolves.toBeUndefined()
    await rm(root, { recursive: true, force: true })
  })
})
