import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../src/main/services/app-store.js'
import { CoreService } from '../../src/main/services/core-service.js'

describe('CoreService', () => {
  it('exposes cached repository capabilities without forcing another resolution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-current-repository-'))
    const resolveRepositorySource = vi.fn(async () => ({
      root, branch: 'main', kind: 'branch-cache' as const, allowSymlink: false, stale: false, cachedAt: null,
    }))
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      core: {
        readConfig: async () => ({ mode: 'remote', remoteUrl: 'https://example.com/catalog.git', defaultBranch: 'main' }),
        resolveRepositorySource,
      },
    })

    await expect(service.currentRepository()).resolves.toEqual({
      branch: 'main', kind: 'branch-cache', allowSymlink: false, stale: false, cachedAt: null,
    })
    await service.currentRepository()
    expect(resolveRepositorySource).toHaveBeenCalledTimes(1)
    await rm(root, { recursive: true, force: true })
  })

  it('keeps the core scan record when loading asset details', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-detail-'))
    const skillRoot = join(root, 'skills', 'detail-skill')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), '---\ndescription: Detail test\n---\n\n# Detail Skill\n')
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      core: {
        readConfig: async () => ({ mode: 'local', defaultBranch: 'main' }),
        resolveRepositorySource: async () => ({ root, branch: 'main', kind: 'local-worktree', allowSymlink: true, stale: false, cachedAt: null }),
      },
    })

    const [asset] = await service.scan({ kind: 'central' })
    const detail = await service.detail({ source: { kind: 'central' }, assetId: asset!.id })

    expect(detail.markdown).toContain('# Detail Skill')
    await rm(root, { recursive: true, force: true })
  })

  it('qualifies installed asset ids by Agent so duplicate names remain selectable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-identities-'))
    const codexRoot = join(root, 'codex', 'skills')
    const claudeRoot = join(root, 'claude', 'skills')
    await mkdir(codexRoot, { recursive: true })
    await mkdir(claudeRoot, { recursive: true })
    const assetAt = (path: string) => ({
      id: 'skills:backend:call-api', type: 'skills' as const, name: 'call-api', group: 'backend',
      path, entryPath: join(path, 'SKILL.md'), entryState: 'active' as const,
      description: 'API helper', version: '1.0.0',
    })
    const agents = [
      { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: join(root, 'codex'), assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true },
      { id: 'claude-code', name: 'Claude Code', projectBaseDir: '.claude', globalBaseDir: join(root, 'claude'), assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true },
    ]
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      core: {
        BUILTIN_AGENTS: agents,
        resolveAgentAssetRoot: (agent, _scope, _base, type) => join(agent.globalBaseDir, agent.assetDirs[type]),
        scanAssets: async ({ root: scanRoot }) => scanRoot === codexRoot || scanRoot === claudeRoot ? [assetAt(join(scanRoot, 'backend', 'call-api'))] : [],
      },
    })

    const assets = await service.scan({ kind: 'global' })
    expect(assets.map((asset) => [asset.id, asset.agentId])).toEqual([
      ['codex:skills:backend:call-api', 'codex'],
      ['claude-code:skills:backend:call-api', 'claude-code'],
    ])
    await rm(root, { recursive: true, force: true })
  })

  it('canonicalizes projects and keeps branch selection in memory until default is persisted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-core-'))
    const projectRoot = join(root, 'project')
    await mkdir(projectRoot)
    const configPath = join(root, 'config.json')
    await writeFile(configPath, JSON.stringify({ mode: 'local', repoPath: root, defaultBranch: 'main' }))
    const store = new AppStore(join(root, 'state.json'))
    const service = new CoreService({ appStore: store, configPath, cacheRoot: join(root, 'cache'), chooseDirectory: async () => projectRoot, core: { resolveRepositorySource: async (_config, branch) => ({ root, branch, kind: 'local-worktree', allowSymlink: true, stale: false, cachedAt: null }) } })

    const project = await service.chooseAndAddProject()
    expect(project?.path).toBe(await realpath(projectRoot))
    await service.selectBranch('feature/demo')
    expect((await service.getConfig()).defaultBranch).toBe('main')
    await service.setDefaultBranch('feature/demo')
    expect((await service.getConfig()).defaultBranch).toBe('feature/demo')
    await service.removeProject(project!.id)
    expect(await readFile(projectRoot).catch(() => null)).toBeNull()
    await rm(root, { recursive: true, force: true })
  })

  it('validates, persists, and activates a repository configuration without dropping CLI fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-config-update-'))
    const oldRoot = join(root, 'old')
    const newRoot = join(root, 'new')
    const configPath = join(root, 'config.json')
    const cacheRoot = join(root, 'cache')
    const calls: string[] = []
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      configPath,
      cacheRoot,
      core: {
        readConfig: async () => ({
          mode: 'local',
          repoPath: oldRoot,
          remoteUrl: 'https://example.com/catalog.git',
          defaultBranch: 'legacy',
          customCliFlag: true,
        }),
        resolveRepositorySource: async (config, branch, receivedCacheRoot) => {
          calls.push(`resolve:${config.mode}:${branch}:${receivedCacheRoot}`)
          expect(config).toMatchObject({
            mode: 'local',
            repoPath: newRoot,
            remoteUrl: 'https://example.com/catalog.git',
            defaultBranch: 'main',
            defaultGroups: ['backend'],
            customCliFlag: true,
          })
          return {
            root: newRoot,
            branch,
            kind: 'local-worktree',
            allowSymlink: true,
            stale: false,
            cachedAt: null,
          }
        },
        scanAssets: async ({ root: receivedRoot }) => {
          calls.push(`scan:${receivedRoot}`)
          return []
        },
        writeConfig: async (config, receivedConfigPath) => {
          calls.push(`write:${config.repoPath}:${receivedConfigPath}`)
          expect(config).toMatchObject({ customCliFlag: true, repoPath: newRoot })
        },
      },
    })

    const result = await service.updateConfig({
      mode: 'local',
      repoPath: newRoot,
      remoteUrl: 'https://example.com/catalog.git',
      defaultBranch: 'main',
      defaultGroups: ['backend'],
    })

    expect(calls).toEqual([
      `resolve:local:main:${cacheRoot}`,
      `scan:${newRoot}`,
      `write:${newRoot}:${configPath}`,
    ])
    expect(result.repository).toEqual({
      branch: 'main',
      kind: 'local-worktree',
      allowSymlink: true,
      stale: false,
      cachedAt: null,
    })
    expect(result.config).toMatchObject({ repoPath: newRoot, customCliFlag: true })
    expect(await service.getConfig()).toMatchObject({ repoPath: newRoot, customCliFlag: true })
    await rm(root, { recursive: true, force: true })
  })

  it('keeps the active configuration when candidate repository validation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-config-resolve-failure-'))
    const oldRoot = join(root, 'old')
    const writeConfig = vi.fn()
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      configPath: join(root, 'config.json'),
      core: {
        readConfig: async () => ({ mode: 'local', repoPath: oldRoot, defaultBranch: 'main' }),
        resolveRepositorySource: async () => {
          throw new Error('repository unavailable')
        },
        writeConfig,
      },
    })
    await service.getConfig()

    await expect(service.updateConfig({
      mode: 'remote',
      repoPath: oldRoot,
      remoteUrl: 'https://example.com/new.git',
      defaultBranch: 'main',
      defaultGroups: [],
    })).rejects.toThrow('repository unavailable')

    expect(writeConfig).not.toHaveBeenCalled()
    expect(await service.getConfig()).toMatchObject({ mode: 'local', repoPath: oldRoot })
    await rm(root, { recursive: true, force: true })
  })

  it('keeps the active configuration when persisting a validated candidate fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-config-write-failure-'))
    const oldRoot = join(root, 'old')
    const newRoot = join(root, 'new')
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      configPath: join(root, 'config.json'),
      cacheRoot: join(root, 'cache'),
      core: {
        readConfig: async () => ({ mode: 'local', repoPath: oldRoot, defaultBranch: 'main' }),
        resolveRepositorySource: async (_config, branch) => ({
          root: newRoot,
          branch,
          kind: 'local-worktree',
          allowSymlink: true,
          stale: false,
          cachedAt: null,
        }),
        scanAssets: async () => [],
        writeConfig: async () => {
          throw new Error('config is read-only')
        },
      },
    })
    await service.getConfig()

    await expect(service.updateConfig({
      mode: 'local',
      repoPath: newRoot,
      remoteUrl: '',
      defaultBranch: 'next',
      defaultGroups: ['frontend'],
    })).rejects.toThrow('config is read-only')

    expect(await service.getConfig()).toMatchObject({
      mode: 'local',
      repoPath: oldRoot,
      defaultBranch: 'main',
    })
    await rm(root, { recursive: true, force: true })
  })

  it('keeps an absent inactive repository source out of the persisted CLI config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-config-optional-source-'))
    const oldRoot = join(root, 'old')
    const newRoot = join(root, 'new')
    const configPath = join(root, 'config.json')
    await writeFile(configPath, JSON.stringify({
      mode: 'local',
      repoPath: oldRoot,
      defaultBranch: 'main',
    }))
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      configPath,
      cacheRoot: join(root, 'cache'),
      core: {
        resolveRepositorySource: async (_config, branch) => ({
          root: newRoot,
          branch,
          kind: 'local-worktree',
          allowSymlink: true,
          stale: false,
          cachedAt: null,
        }),
        scanAssets: async () => [],
      },
    })

    await service.updateConfig({
      mode: 'local',
      repoPath: newRoot,
      remoteUrl: '',
      defaultBranch: 'main',
      defaultGroups: [],
    })

    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({
      mode: 'local',
      repoPath: newRoot,
      defaultBranch: 'main',
      defaultGroups: [],
    })
    await rm(root, { recursive: true, force: true })
  })

  it('reports copy and symlink installation methods for status locations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-method-'))
    const centralRoot = join(root, 'central')
    const globalSkills = join(root, 'global-skills')
    const globalRules = join(root, 'global-rules')
    const globalWorkflows = join(root, 'global-workflows')
    const group = '开发'
    const name = 'Method Skill'
    const centralPath = join(centralRoot, group, name)
    const installedPath = join(globalSkills, group, name)
    const entry = (path: string) => ({ id: 'method-skill', type: 'skills' as const, name, group, path, entryPath: join(path, 'SKILL.md'), entryState: 'active' as const, description: 'method test', version: '1.0.0' })
    const centralAsset = entry(centralPath)
    const installedAsset = entry(installedPath)
    await mkdir(join(centralPath), { recursive: true })
    await mkdir(join(installedPath), { recursive: true })
    await mkdir(globalRules, { recursive: true })
    await mkdir(globalWorkflows, { recursive: true })
    await writeFile(join(centralPath, 'SKILL.md'), '# central')
    await writeFile(join(installedPath, 'SKILL.md'), '# installed')
    const agent = { id: 'method-agent', name: 'Method Agent', projectBaseDir: root, globalBaseDir: root, assetDirs: { skills: globalSkills, rules: globalRules, workflows: globalWorkflows }, builtIn: true, enabled: true }
    const status = { status: 'current' as const, updateAvailable: false, locallyModified: false, sourceHash: 'a', installedHash: 'a', sourceVersion: '1.0.0', installedVersion: '1.0.0', resolvedTarget: null, reason: '' }
    const seenRoots: string[] = []
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      core: {
        BUILTIN_AGENTS: [agent],
        readConfig: async () => ({ mode: 'local', defaultBranch: 'main' }),
        resolveRepositorySource: async () => ({ root: centralRoot, branch: 'main', kind: 'local-worktree', allowSymlink: true, stale: false, cachedAt: null }),
        resolveAgentAssetRoot: (_agent, _scope, _base, type) => ({ skills: globalSkills, rules: globalRules, workflows: globalWorkflows })[type],
        scanAssets: async ({ root: scanRoot }) => { seenRoots.push(scanRoot); return scanRoot === centralRoot ? [centralAsset] : scanRoot === globalSkills ? [installedAsset] : [] },
        evaluateAssetStatus: async () => status,
      },
    })
    const scanned = await service.scan({ kind: 'global' })
    const selection = { source: { kind: 'global' as const }, assetId: scanned[0]!.id }
    expect(seenRoots).toContain(globalSkills)
    expect(scanned).toHaveLength(1)
    expect((await service.statuses(selection))[0]?.method).toBe('copy')
    await rm(join(installedPath, 'SKILL.md'))
    await symlink(join(centralPath, 'SKILL.md'), join(installedPath, 'SKILL.md'))
    expect((await service.statuses(selection))[0]?.method).toBe('symlink')
    await rm(root, { recursive: true, force: true })
  })

  it('matches a flat project installation to its uniquely named grouped central asset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-flat-status-'))
    const centralRoot = join(root, 'central')
    const projectRoot = join(root, 'project')
    await mkdir(projectRoot, { recursive: true })
    const canonicalProjectRoot = await realpath(projectRoot)
    const projectSkills = join(canonicalProjectRoot, '.codex', 'skills')
    const installedPath = join(projectSkills, 'call-api')
    await mkdir(installedPath, { recursive: true })
    const store = new AppStore(join(root, 'state.json'))
    await store.addProject({ id: 'project-1', name: 'Project', path: projectRoot })
    const centralAsset = {
      id: 'central-call-api', type: 'skills' as const, name: 'call-api', group: 'backend',
      path: join(centralRoot, 'backend', 'skills', 'call-api'), entryPath: join(centralRoot, 'backend', 'skills', 'call-api', 'SKILL.md'),
      entryState: 'active' as const, description: 'API helper', version: '1.0.0',
    }
    const installedAsset = {
      ...centralAsset, id: 'installed-call-api', group: '', path: installedPath, entryPath: join(installedPath, 'SKILL.md'),
    }
    const status = { status: 'current' as const, updateAvailable: false, locallyModified: false, sourceHash: 'same', installedHash: 'same', sourceVersion: '1.0.0', installedVersion: '1.0.0', resolvedTarget: installedPath, reason: '内容一致' }
    const evaluateAssetStatus = vi.fn(async () => status)
    const agent = { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: join(root, 'global', '.codex'), assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true }
    const service = new CoreService({
      appStore: store,
      core: {
        BUILTIN_AGENTS: [agent],
        readConfig: async () => ({ mode: 'local', defaultBranch: 'main' }),
        resolveRepositorySource: async () => ({ root: centralRoot, branch: 'main', kind: 'local-worktree', allowSymlink: true, stale: false, cachedAt: null }),
        resolveAgentAssetRoot: (_agent, scope, base, type) => scope === 'project' ? join(base, '.codex', type) : join(root, 'global', '.codex', type),
        scanAssets: async ({ root: scanRoot }) => scanRoot === centralRoot ? [centralAsset] : scanRoot === projectSkills ? [installedAsset] : [],
        evaluateAssetStatus,
      },
    })

    const [asset] = await service.scan({ kind: 'project', projectId: 'project-1' })
    const [location] = await service.statuses({ source: { kind: 'project', projectId: 'project-1' }, assetId: asset!.id })

    expect(location?.status.status).toBe('current')
    expect(evaluateAssetStatus).toHaveBeenCalledWith(centralAsset, installedPath)
    await rm(root, { recursive: true, force: true })
  })

  it('checks central asset status at flat Agent installation paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-flat-paths-'))
    const centralRoot = join(root, 'central')
    const projectRoot = join(root, 'project')
    const globalSkills = join(root, 'global', '.codex', 'skills')
    await mkdir(projectRoot, { recursive: true })
    const canonicalProjectRoot = await realpath(projectRoot)
    const store = new AppStore(join(root, 'state.json'))
    await store.addProject({ id: 'project-1', name: 'Project', path: projectRoot })
    const centralAsset = {
      id: 'central-call-api', type: 'skills' as const, name: 'call-api', group: 'backend',
      path: join(centralRoot, 'backend', 'skills', 'call-api'), entryPath: join(centralRoot, 'backend', 'skills', 'call-api', 'SKILL.md'),
      entryState: 'active' as const, description: 'API helper', version: '1.0.0',
    }
    const status = { status: 'not_installed' as const, updateAvailable: false, locallyModified: false, sourceHash: 'source', installedHash: null, sourceVersion: '1.0.0', installedVersion: null, resolvedTarget: null, reason: '未安装' }
    const evaluateAssetStatus = vi.fn(async () => status)
    const agent = { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: join(root, 'global', '.codex'), assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true }
    const service = new CoreService({
      appStore: store,
      core: {
        BUILTIN_AGENTS: [agent],
        readConfig: async () => ({ mode: 'local', defaultBranch: 'main' }),
        resolveRepositorySource: async () => ({ root: centralRoot, branch: 'main', kind: 'local-worktree', allowSymlink: true, stale: false, cachedAt: null }),
        resolveAgentAssetRoot: (_agent, scope, base, type) => scope === 'project' ? join(base, '.codex', type) : join(root, 'global', '.codex', type),
        scanAssets: async ({ root: scanRoot }) => scanRoot === centralRoot ? [centralAsset] : [],
        evaluateAssetStatus,
      },
    })

    const [asset] = await service.scan({ kind: 'central' })
    const locations = await service.statuses({ source: { kind: 'central' }, assetId: asset!.id })

    expect(locations.map((location) => location.path)).toEqual([
      join(globalSkills, 'call-api'),
      join(canonicalProjectRoot, '.codex', 'skills', 'call-api'),
    ])
    await rm(root, { recursive: true, force: true })
  })

  it('does not guess a central group for ambiguous flat installations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-flat-ambiguous-'))
    const centralRoot = join(root, 'central')
    const globalSkills = join(root, 'global', '.codex', 'skills')
    const installedPath = join(globalSkills, 'call-api')
    await mkdir(installedPath, { recursive: true })
    const asset = (id: string, group: string, path: string) => ({ id, type: 'skills' as const, name: 'call-api', group, path, entryPath: join(path, 'SKILL.md'), entryState: 'active' as const, description: 'API helper', version: '1.0.0' })
    const centralAssets = [asset('backend-call-api', 'backend', join(centralRoot, 'backend', 'skills', 'call-api')), asset('common-call-api', 'common', join(centralRoot, 'common', 'skills', 'call-api'))]
    const installedAsset = asset('installed-call-api', '', installedPath)
    const agent = { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: join(root, 'global', '.codex'), assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true }
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      core: {
        BUILTIN_AGENTS: [agent],
        readConfig: async () => ({ mode: 'local', defaultBranch: 'main' }),
        resolveRepositorySource: async () => ({ root: centralRoot, branch: 'main', kind: 'local-worktree', allowSymlink: true, stale: false, cachedAt: null }),
        resolveAgentAssetRoot: (_agent, _scope, _base, type) => join(root, 'global', '.codex', type),
        scanAssets: async ({ root: scanRoot }) => scanRoot === centralRoot ? centralAssets : scanRoot === globalSkills ? [installedAsset] : [],
      },
    })

    const [scanned] = await service.scan({ kind: 'global' })
    const [location] = await service.statuses({ source: { kind: 'global' }, assetId: scanned!.id })

    expect(location?.status).toMatchObject({ status: 'unknown', reason: '中央仓库存在多个同名资产，无法确定来源分组' })
    await rm(root, { recursive: true, force: true })
  })

  it('keeps same-named third-party assets isolated and reads details from Core provenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-third-party-detail-'))
    const store = new AppStore(join(root, 'state.json'))
    const timestamp = '2026-09-01T00:00:00.000Z'
    for (const id of ['repo-1', 'repo-2']) {
      await store.saveThirdPartyRepository({ id, name: id, url: `https://example.com/${id}.git`, branch: 'main', layout: 'catalog', createdAt: timestamp, lastFetchedAt: timestamp })
    }
    const rawAssets = new Map(['repo-1', 'repo-2'].map((id) => [id, {
      id: 'same-asset-id', type: 'skills' as const, name: 'shared-skill', group: 'common',
      path: join(root, id, 'shared-skill'), entryPath: join(root, id, 'shared-skill', 'SKILL.md'),
      entryState: 'active' as const, description: id, version: null,
    }]))
    const thirdPartyRepositories = {
      resolve: vi.fn(async (id: string) => {
        const asset = rawAssets.get(id)!
        const repository = (await store.listThirdPartyRepositories()).find((entry) => entry.id === id)!
        return { repository, root: join(root, id), branch: 'main', commit: 'a'.repeat(40), layout: 'catalog' as const, stale: false, cachedAt: timestamp, lastError: null, assets: [asset], coreAssets: [asset] }
      }),
    }
    const readAssetDetail = vi.fn(async (asset: { path: string }) => ({ ...asset, markdown: `# ${asset.path}`, evolution: null, files: [] }))
    const service = new CoreService({
      appStore: store,
      thirdPartyRepositories: thirdPartyRepositories as never,
      core: { readAssetDetail: readAssetDetail as never },
    })

    const [first] = await service.scan({ kind: 'third-party', repositoryId: 'repo-1' })
    const [second] = await service.scan({ kind: 'third-party', repositoryId: 'repo-2' })
    const firstDetail = await service.detail({ source: { kind: 'third-party', repositoryId: 'repo-1' }, assetId: first!.id })
    const secondDetail = await service.detail({ source: { kind: 'third-party', repositoryId: 'repo-2' }, assetId: second!.id })

    expect(first?.description).toBe('repo-1')
    expect(second?.description).toBe('repo-2')
    expect(firstDetail.markdown).toContain('/repo-1/')
    expect(secondDetail.markdown).toContain('/repo-2/')
    expect(readAssetDetail).toHaveBeenNthCalledWith(1, rawAssets.get('repo-1'))
    expect(readAssetDetail).toHaveBeenNthCalledWith(2, rawAssets.get('repo-2'))
    await rm(root, { recursive: true, force: true })
  })

  it('reports source_unavailable when an installed Skill points to a removed repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-third-party-missing-'))
    const globalSkills = join(root, 'global', 'skills')
    const installedPath = join(globalSkills, 'shared-skill')
    await mkdir(installedPath, { recursive: true })
    const store = new AppStore(join(root, 'state.json'))
    const installed = {
      id: 'installed-skill', type: 'skills' as const, name: 'shared-skill', group: 'common', path: installedPath,
      entryPath: join(installedPath, 'SKILL.md'), entryState: 'active' as const, description: 'Installed', version: null,
    }
    await store.upsertInstallationSource({
      id: 'install-1', scope: 'global', projectId: null, agentId: 'codex', targetPath: installedPath,
      asset: { type: 'skills', group: 'common', name: 'shared-skill' },
      source: { kind: 'third-party', repositoryId: 'removed-repo', repositoryName: 'Removed', repositoryUrl: 'https://example.com/removed.git' },
      installedCommit: 'a'.repeat(40), installedHash: 'installed-hash',
    })
    const agent = { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: join(root, 'global'), assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true }
    const service = new CoreService({
      appStore: store,
      thirdPartyRepositories: { resolve: async () => { throw new Error('unknown third-party repository id') } } as never,
      core: {
        BUILTIN_AGENTS: [agent],
        resolveAgentAssetRoot: (_agent, _scope, _base, type) => join(root, 'global', type),
        scanAssets: async ({ root: scanRoot }) => scanRoot === globalSkills ? [installed] : [],
      },
    })

    const [asset] = await service.scan({ kind: 'global' })
    const [location] = await service.statuses({ source: { kind: 'global' }, assetId: asset!.id })

    expect(location?.status).toMatchObject({ status: 'source_unavailable', reason: '来源仓库不可用' })
    await rm(root, { recursive: true, force: true })
  })

  it('relinks an installation only when its content matches the selected third-party source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-third-party-relink-'))
    const targetPath = join(root, 'installed', 'demo')
    await mkdir(targetPath, { recursive: true })
    const store = new AppStore(join(root, 'state.json'))
    const repository = { id: 'repo-1', name: 'Team Skills', url: 'https://example.com/team.git', branch: 'main', layout: 'catalog' as const, createdAt: '2026-09-01T00:00:00.000Z', lastFetchedAt: '2026-09-01T01:00:00.000Z' }
    await store.saveThirdPartyRepository(repository)
    await store.upsertInstallationSource({
      id: 'install-1', scope: 'global', projectId: null, agentId: 'codex', targetPath,
      asset: { type: 'skills', group: '', name: 'demo' },
      source: { kind: 'central', repositoryId: null, repositoryName: 'Central', repositoryUrl: null },
      installedCommit: null, installedHash: 'same-hash',
    })
    const rawAsset = { id: 'asset-1', type: 'skills' as const, name: 'demo', group: '', path: join(root, 'source', 'demo'), entryPath: join(root, 'source', 'demo', 'SKILL.md'), entryState: 'active' as const, description: 'Demo', version: null }
    const thirdPartyRepositories = { resolve: async () => ({ repository, root: join(root, 'source'), branch: 'main', commit: 'b'.repeat(40), layout: 'catalog' as const, stale: false, cachedAt: repository.lastFetchedAt, lastError: null, assets: [rawAsset], coreAssets: [rawAsset] }) }
    const evaluateAssetStatus = vi.fn(async () => ({ status: 'current' as const, updateAvailable: false, locallyModified: false, sourceHash: 'same-hash', installedHash: 'same-hash', sourceVersion: null, installedVersion: null, resolvedTarget: targetPath, reason: 'current' }))
    const service = new CoreService({ appStore: store, thirdPartyRepositories: thirdPartyRepositories as never, core: { evaluateAssetStatus } })

    await expect(service.relinkInstallation({ installationId: 'missing', repositoryId: 'repo-1', assetId: 'asset-1' })).rejects.toThrow(/unknown installation/i)
    await service.relinkInstallation({ installationId: 'install-1', repositoryId: 'repo-1', assetId: 'asset-1' })
    await expect(store.listInstallationSources()).resolves.toMatchObject([{
      id: 'install-1',
      source: { kind: 'third-party', repositoryId: 'repo-1', repositoryName: 'Team Skills' },
      installedCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    }])
    expect(evaluateAssetStatus).toHaveBeenCalledWith(rawAsset, await realpath(targetPath))
    await rm(root, { recursive: true, force: true })
  })
})
