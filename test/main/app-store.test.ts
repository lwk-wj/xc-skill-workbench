import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppStore } from '../../src/main/services/app-store.js'

describe('AppStore', () => {
  it('adds a project and persists a validated versioned state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-store-'))
    const project = join(root, 'Admin')
    await mkdir(project)
    const store = new AppStore(join(root, 'state.json'))

    await store.addProject({ id: 'project-1', name: 'Admin', path: project })
    await store.setTheme('dark')

    await expect(store.read()).resolves.toMatchObject({
      version: 2,
      theme: 'dark',
      projects: [{ id: 'project-1', name: 'Admin', path: await realpath(project) }],
      thirdPartyRepositories: [],
      installationSources: [],
    })
    expect(JSON.parse(await readFile(join(root, 'state.json'), 'utf8')).version).toBe(2)
  })

  it('rejects duplicate canonical project paths and paths containing state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-store-'))
    const project = join(root, 'repo')
    await mkdir(project)
    const store = new AppStore(join(project, 'state.json'))
    await expect(store.addProject({ id: 'one', name: 'One', path: project })).rejects.toThrow()
  })

  it('migrates V1 state in memory and writes V2 on the next mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-store-'))
    const statePath = join(root, 'state.json')
    const project = join(root, 'LegacyProject')
    await mkdir(project)
    const legacy = {
      version: 1,
      projects: [{ id: 'legacy', name: 'Legacy', path: project }],
      customAgents: [],
      agentEnabled: { codex: false },
      theme: 'dark',
      lastSource: { kind: 'project', projectId: 'legacy' },
      windowBounds: { width: 1200, height: 800 },
    }
    await writeFile(statePath, JSON.stringify(legacy))
    const store = new AppStore(statePath)

    await expect(store.read()).resolves.toMatchObject({
      ...legacy,
      version: 2,
      projects: [{ ...legacy.projects[0], path: await realpath(project) }],
      thirdPartyRepositories: [],
      installationSources: [],
    })
    expect(JSON.parse(await readFile(statePath, 'utf8')).version).toBe(1)

    await store.setTheme('light')
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({
      version: 2,
      theme: 'light',
      thirdPartyRepositories: [],
      installationSources: [],
    })
  })

  it('rejects duplicate repository sources, duplicate canonical installation targets, and invalid timestamps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-store-'))
    const statePath = join(root, 'state.json')
    const repository = {
      id: 'repo-1',
      name: 'Team Skills',
      url: 'https://example.com/team/skills.git',
      branch: 'main',
      layout: 'catalog',
      createdAt: '2026-09-01T00:00:00.000Z',
      lastFetchedAt: null,
    }
    const installation = {
      id: 'install-1',
      scope: 'global',
      projectId: null,
      agentId: 'codex',
      targetPath: join(root, 'global', 'skill'),
      asset: { type: 'skills', group: '', name: 'skill' },
      source: {
        kind: 'third-party',
        repositoryId: 'repo-1',
        repositoryName: 'Team Skills',
        repositoryUrl: repository.url,
      },
      installedCommit: 'a'.repeat(40),
      installedHash: 'hash-1',
    }
    const baseState = {
      version: 2,
      projects: [],
      customAgents: [],
      agentEnabled: {},
      theme: 'system',
      lastSource: { kind: 'central' },
      windowBounds: null,
      thirdPartyRepositories: [repository],
      installationSources: [installation],
    }
    const store = new AppStore(statePath)

    await writeFile(statePath, JSON.stringify({
      ...baseState,
      thirdPartyRepositories: [repository, { ...repository, id: 'repo-2', name: 'Duplicate' }],
    }))
    await expect(store.read()).rejects.toThrow(/duplicate repository source/i)

    await writeFile(statePath, JSON.stringify({
      ...baseState,
      installationSources: [installation, {
        ...installation,
        id: 'install-2',
        targetPath: join(root, 'global', 'nested', '..', 'skill'),
      }],
    }))
    await expect(store.read()).rejects.toThrow(/duplicate installation target/i)

    await writeFile(statePath, JSON.stringify({
      ...baseState,
      thirdPartyRepositories: [{ ...repository, createdAt: 'yesterday' }],
    }))
    await expect(store.read()).rejects.toThrow()
  })

  it('falls back to central when the saved third-party source no longer exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-store-'))
    const statePath = join(root, 'state.json')
    await writeFile(statePath, JSON.stringify({
      version: 2,
      projects: [], customAgents: [], agentEnabled: {}, theme: 'system', windowBounds: null,
      lastSource: { kind: 'third-party', repositoryId: 'missing-repo' },
      thirdPartyRepositories: [], installationSources: [],
    }))

    await expect(new AppStore(statePath).read()).resolves.toMatchObject({ lastSource: { kind: 'central' } })
  })

  it('stores repositories and installation provenance by stable IDs and normalized targets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-store-'))
    const store = new AppStore(join(root, 'state.json'))
    const repository = {
      id: 'repo-1', name: 'Team Skills', url: 'https://example.com/team/skills.git', branch: 'main',
      layout: 'catalog' as const, skillRoots: [], createdAt: '2026-09-01T00:00:00.000Z', lastFetchedAt: null,
    }
    await expect(store.saveThirdPartyRepository(repository)).resolves.toEqual([repository])
    await store.setLastSource({ kind: 'third-party', repositoryId: repository.id })

    const record = {
      id: 'install-1', scope: 'global' as const, projectId: null, agentId: 'codex',
      targetPath: join(root, 'targets', 'nested', '..', 'skill'),
      asset: { type: 'skills' as const, group: '', name: 'skill' },
      source: { kind: 'third-party' as const, repositoryId: repository.id, repositoryName: repository.name, repositoryUrl: repository.url },
      installedCommit: 'a'.repeat(40), installedHash: 'hash-1',
    }
    await store.upsertInstallationSource(record)
    await expect(store.findInstallationSourceByTarget({ scope: 'global', projectId: null, agentId: 'codex', targetPath: join(root, 'targets', 'skill') }))
      .resolves.toMatchObject({ id: 'install-1', targetPath: join(root, 'targets', 'skill') })

    await expect(store.upsertInstallationSource({ ...record, id: 'install-2' })).rejects.toThrow(/duplicate installation target/i)
    await store.removeThirdPartyRepository(repository.id)
    await expect(store.getLastSource()).resolves.toEqual({ kind: 'central' })
    await expect(store.listInstallationSources()).resolves.toHaveLength(1)
    await store.removeInstallationSource(record.id)
    await expect(store.listInstallationSources()).resolves.toEqual([])
  })
})
