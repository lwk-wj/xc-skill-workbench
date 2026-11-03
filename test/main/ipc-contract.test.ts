import { describe, expect, it, vi } from 'vitest'
import {
  Channels,
  CustomAgentDirectorySchema,
  OperationRequestSchema,
  RepositoryConfigInputSchema,
  ThirdPartyRepositoryInputSchema,
  ThirdPartyRepositoryViewSchema,
  SourceSelectionSchema,
  AssetStatusRecordSchema,
  ThemePreferenceSchema,
  ExternalUrlSchema,
} from '../../src/shared/ipc.js'
import { AppStore } from '../../src/main/services/app-store.js'
import { registerIpc } from '../../src/main/ipc/register-ipc.js'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('IPC contracts', () => {
  it('rejects traversal in custom Agent directories', () => {
    expect(() => CustomAgentDirectorySchema.parse({ id: 'custom', name: 'Custom', projectBaseDir: '/tmp/../secret', globalBaseDir: '/tmp/custom', assetDirs: { skills: '/tmp/custom/skills', rules: '/tmp/custom/rules', workflows: '/tmp/custom/workflows' }, builtIn: false, enabled: true })).toThrow()
  })

  it('rejects unknown Agent IDs before invoking the operation handler', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-ipc-'))
    const store = new AppStore(join(root, 'state.json'))
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>()
    registerIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, appStore: store, builtInAgentIds: ['known'], services: { plan: async () => { throw new Error('must not run') } } })
    const request = OperationRequestSchema.parse({
      kind: 'install',
      asset: { source: { kind: 'central' }, assetId: 'asset-1' },
      target: { scope: 'global', agentId: 'unknown-agent' },
      method: 'copy',
    })
    await expect(handlers.get('operations:plan')?.({}, request)).rejects.toThrow(/unknown Agent/)
  })

  it('parses source-conflict inspection requests and Main-derived responses', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-conflict-ipc-'))
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>()
    const inspectSourceConflict = vi.fn(async () => ({
      targetPath: '/tmp/skills/demo',
      existing: { kind: 'central' as const, repositoryId: null, label: '中央仓库' },
      requested: { kind: 'third-party' as const, repositoryId: 'repo-1', label: 'Team Skills' },
    }))
    registerIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      appStore: new AppStore(join(root, 'state.json')),
      services: { inspectSourceConflict },
    })
    const request = {
      kind: 'install',
      asset: { source: { kind: 'third-party', repositoryId: 'repo-1' }, assetId: 'asset-1' },
      target: { scope: 'global', agentId: 'codex' },
      method: 'copy',
      replaceExistingSource: true,
    }

    await expect(handlers.get(Channels.operationsInspectSourceConflict)?.({}, request)).resolves.toMatchObject({
      requested: { repositoryId: 'repo-1' },
    })
    await expect(handlers.get(Channels.operationsInspectSourceConflict)?.({}, { ...request, targetPath: '/tmp/forged' })).rejects.toThrow()
    expect(inspectSourceConflict).toHaveBeenCalledTimes(1)
  })

  it('rejects non-http external URLs and invalid themes', () => {
    expect(() => ExternalUrlSchema.parse('file:///etc/passwd')).toThrow()
    expect(() => ThemePreferenceSchema.parse('solarized')).toThrow()
  })

  it('defines strict third-party repository, source, and unavailable-status contracts', () => {
    expect(ThirdPartyRepositoryInputSchema.parse({
      url: ' https://example.com/team/skills.git ',
      name: ' Team Skills ',
      branch: ' trunk ',
      skillRoots: [
        { relativePath: ' skills/engineering ', group: ' engineering ' },
        { relativePath: 'skills/productivity', group: '' },
      ],
    })).toEqual({
      url: 'https://example.com/team/skills.git',
      name: 'Team Skills',
      branch: 'trunk',
      skillRoots: [
        { relativePath: 'skills/engineering', group: 'engineering' },
        { relativePath: 'skills/productivity', group: '' },
      ],
    })
    expect(() => ThirdPartyRepositoryInputSchema.parse({
      url: 'https://example.com/skills.git',
      skillRoots: [{ relativePath: '../outside', group: '' }],
    })).toThrow()
    expect(() => ThirdPartyRepositoryInputSchema.parse({
      url: 'https://example.com/skills.git',
      skillRoots: [
        { relativePath: 'skills/backend', group: 'one' },
        { relativePath: 'skills/backend', group: 'two' },
      ],
    })).toThrow()
    expect(() => ThirdPartyRepositoryInputSchema.parse({ url: 'https://example.com/skills.git', cacheRoot: '/tmp/forged' })).toThrow()
    expect(SourceSelectionSchema.parse({ kind: 'third-party', repositoryId: 'repo-1' })).toEqual({ kind: 'third-party', repositoryId: 'repo-1' })
    expect(ThirdPartyRepositoryViewSchema.parse({
      id: 'repo-1', name: 'Team Skills', url: 'https://example.com/skills.git', branch: 'trunk', layout: 'catalog',
      skillRoots: [],
      createdAt: '2026-09-01T00:00:00.000Z', lastFetchedAt: null,
      skillCount: 2, stale: false, cachedAt: null, lastError: null,
    })).not.toHaveProperty('cacheRoot')
    expect(AssetStatusRecordSchema.parse({
      status: 'source_unavailable', updateAvailable: false, locallyModified: false,
      sourceHash: null, installedHash: 'hash', sourceVersion: null, installedVersion: null,
      resolvedTarget: '/tmp/skill', reason: 'repository removed',
    }).status).toBe('source_unavailable')
  })

  it('normalizes editable repository configuration without dropping inactive sources', () => {
    expect(RepositoryConfigInputSchema.parse({
      mode: 'local',
      repoPath: '/tmp/catalog',
      remoteUrl: 'https://example.com/catalog.git',
      defaultBranch: ' main ',
      defaultGroups: [' backend ', 'backend', '', ' common '],
    })).toEqual({
      mode: 'local',
      repoPath: '/tmp/catalog',
      remoteUrl: 'https://example.com/catalog.git',
      defaultBranch: 'main',
      defaultGroups: ['backend', 'common'],
    })

    expect(RepositoryConfigInputSchema.parse({
      mode: 'remote',
      repoPath: '/tmp/catalog',
      remoteUrl: ' https://example.com/catalog.git ',
      defaultBranch: 'release',
      defaultGroups: [],
    })).toEqual({
      mode: 'remote',
      repoPath: '/tmp/catalog',
      remoteUrl: 'https://example.com/catalog.git',
      defaultBranch: 'release',
      defaultGroups: [],
    })
  })

  it('rejects a missing active repository source and blank default branch', () => {
    expect(() => RepositoryConfigInputSchema.parse({
      mode: 'local',
      repoPath: '',
      remoteUrl: 'https://example.com/catalog.git',
      defaultBranch: 'main',
      defaultGroups: [],
    })).toThrow(/local repository path required/)

    expect(() => RepositoryConfigInputSchema.parse({
      mode: 'remote',
      repoPath: '/tmp/catalog',
      remoteUrl: '',
      defaultBranch: 'main',
      defaultGroups: [],
    })).toThrow(/remote repository URL required/)

    expect(() => RepositoryConfigInputSchema.parse({
      mode: 'remote',
      repoPath: '/tmp/catalog',
      remoteUrl: 'https://example.com/catalog.git',
      defaultBranch: ' ',
      defaultGroups: [],
    })).toThrow(/default branch required/)
  })

  it('uses dedicated channels for repository configuration actions', () => {
    expect(Channels.repositoriesChooseLocalPath).toBe('repositories:chooseLocalPath')
    expect(Channels.repositoriesUpdateConfig).toBe('repositories:updateConfig')
    expect(Channels.repositoriesCurrent).toBe('repositories:current')
  })

  it('publishes only local selections and executes with a server-issued token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-publish-ipc-'))
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>()
    const previewPublish = vi.fn(async () => ({
      token: 'publish-1', assetName: 'demo', assetType: 'skills' as const,
      sourcePath: '/tmp/project/.codex/skills/demo', targetRelativePath: 'backend/skills/demo',
      branch: 'main', remoteUrl: 'https://example.com/skills.git', change: 'create' as const,
      warnings: [], expiresAt: '2026-09-07T10:00:00.000Z',
    }))
    const executePublish = vi.fn(async () => ({
      status: 'published' as const, commit: 'a'.repeat(40), branch: 'main', targetRelativePath: 'backend/skills/demo',
    }))
    registerIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      appStore: new AppStore(join(root, 'state.json')),
      services: { previewPublish, executePublish },
    })

    const request = { asset: { source: { kind: 'project', projectId: 'project-1' }, assetId: 'asset-1' }, targetGroup: 'backend' }
    await expect(handlers.get(Channels.publishingPreview)?.({}, request)).resolves.toMatchObject({ token: 'publish-1' })
    await expect(handlers.get(Channels.publishingPreview)?.({}, { ...request, targetPath: '/tmp/forged' })).rejects.toThrow()
    await expect(handlers.get(Channels.publishingPreview)?.({}, { asset: { source: { kind: 'central' }, assetId: 'asset-1' }, targetGroup: '' })).rejects.toThrow()
    await expect(handlers.get(Channels.publishingExecute)?.({}, { token: 'publish-1' })).rejects.toThrow()
    await expect(handlers.get(Channels.publishingExecute)?.({}, 'publish-1')).resolves.toMatchObject({ status: 'published' })
    expect(executePublish).toHaveBeenCalledWith('publish-1')
  })

  it('requires a server-issued migration token and rejects forged migration paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-migration-ipc-'))
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>()
    const previewAssetStoreMigration = vi.fn(async (path: string) => ({
      token: 'migration-1', fromPath: '/tmp/old-store', toPath: path, entityCount: 2,
      symlinkTargets: ['/tmp/project/.codex/skills/demo'], copyTargets: [], conflicts: [],
      expiresAt: '2026-09-01T10:00:00.000Z',
    }))
    const executeAssetStoreMigration = vi.fn(async () => ({ assetStorePath: '/tmp/new-store' }))
    registerIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      appStore: new AppStore(join(root, 'state.json')),
      services: { previewAssetStoreMigration, executeAssetStoreMigration },
    })

    await expect(handlers.get(Channels.repositoriesPreviewAssetStoreMigration)?.({}, '../forged')).rejects.toThrow()
    await expect(handlers.get(Channels.repositoriesPreviewAssetStoreMigration)?.({}, '/tmp/new-store')).resolves.toMatchObject({ token: 'migration-1' })
    await expect(handlers.get(Channels.repositoriesExecuteAssetStoreMigration)?.({}, { token: 'migration-1', path: '/tmp/forged' })).rejects.toThrow()
    await expect(handlers.get(Channels.repositoriesExecuteAssetStoreMigration)?.({}, 'migration-1')).resolves.toMatchObject({ assetStorePath: '/tmp/new-store' })
    expect(executeAssetStoreMigration).toHaveBeenCalledWith('migration-1')
  })

  it('accepts only an opaque token when executing legacy installation migration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-legacy-migration-ipc-'))
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>()
    const preview = {
      token: 'legacy-1', candidates: [], conflicts: [], expiresAt: '2026-09-01T10:00:00.000Z',
    }
    const executeLegacyInstallationMigration = vi.fn(async () => preview)
    registerIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      appStore: new AppStore(join(root, 'state.json')),
      services: { previewLegacyInstallationMigration: vi.fn(async () => preview), executeLegacyInstallationMigration },
    })

    await expect(handlers.get(Channels.repositoriesPreviewLegacyInstallationMigration)?.({}, undefined)).resolves.toEqual(preview)
    await expect(handlers.get(Channels.repositoriesExecuteLegacyInstallationMigration)?.({}, { token: 'legacy-1', targetPath: '/tmp/forged' })).rejects.toThrow()
    await expect(handlers.get(Channels.repositoriesExecuteLegacyInstallationMigration)?.({}, 'legacy-1')).resolves.toEqual(preview)
    expect(executeLegacyInstallationMigration).toHaveBeenCalledWith('legacy-1')
  })

  it('accepts only server-issued tokens for source-layout migration and entity repair', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-source-layout-ipc-'))
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>()
    const sourcePreview = {
      token: 'layout-1', moves: [], unresolved: [], symlinkCount: 0, copyCount: 0,
      conflicts: [], expiresAt: '2026-09-01T10:00:00.000Z',
    }
    const repairPreview = {
      installationId: 'install-1', entityId: 'entity-1', candidates: [{
        candidateToken: 'candidate-1', repositoryLabel: 'Team Skills', sourceRelativePath: 'skills/demo',
      }], expiresAt: '2026-09-01T10:00:00.000Z',
    }
    const executeSourceLayoutMigration = vi.fn(async () => sourcePreview)
    const executeManagedEntityRepair = vi.fn(async () => ({
      installationId: 'install-1', entityId: 'entity-2', fromRelativePath: 'legacy',
      toRelativePath: 'team/skills/demo', rebuiltSymlinkCount: 1,
    }))
    registerIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      appStore: new AppStore(join(root, 'state.json')),
      services: {
        previewSourceLayoutMigration: vi.fn(async () => sourcePreview),
        executeSourceLayoutMigration,
        previewManagedEntityRepair: vi.fn(async () => repairPreview),
        executeManagedEntityRepair,
      },
    })

    await expect(handlers.get(Channels.repositoriesPreviewSourceLayoutMigration)?.({}, undefined)).resolves.toEqual(sourcePreview)
    await expect(handlers.get(Channels.repositoriesExecuteSourceLayoutMigration)?.({}, { token: 'layout-1', path: '/tmp/forged' })).rejects.toThrow()
    await expect(handlers.get(Channels.repositoriesExecuteSourceLayoutMigration)?.({}, 'layout-1')).resolves.toEqual(sourcePreview)
    await expect(handlers.get(Channels.repositoriesPreviewManagedEntityRepair)?.({}, 'install-1')).resolves.toEqual(repairPreview)
    await expect(handlers.get(Channels.repositoriesPreviewManagedEntityRepair)?.({}, { installationId: 'install-1' })).rejects.toThrow()
    await expect(handlers.get(Channels.repositoriesExecuteManagedEntityRepair)?.({}, { candidateToken: 'candidate-1' })).rejects.toThrow()
    await expect(handlers.get(Channels.repositoriesExecuteManagedEntityRepair)?.({}, 'candidate-1')).resolves.toMatchObject({ entityId: 'entity-2' })
    expect(executeSourceLayoutMigration).toHaveBeenCalledWith('layout-1')
    expect(executeManagedEntityRepair).toHaveBeenCalledWith('candidate-1')
  })

  it('uses strict declarative channels for third-party repository management', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-third-party-ipc-'))
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>()
    const repository = {
      id: 'repo-1', name: 'Team Skills', url: 'https://example.com/team/skills.git', branch: 'main', layout: 'catalog' as const,
      skillRoots: [],
      createdAt: '2026-09-01T00:00:00.000Z', lastFetchedAt: '2026-09-01T01:00:00.000Z',
      skillCount: 2, stale: false, cachedAt: '2026-09-01T01:00:00.000Z', lastError: null,
    }
    const listThirdPartyRepositories = vi.fn(async () => [repository])
    const addThirdPartyRepository = vi.fn(async () => repository)
    const updateThirdPartyRepository = vi.fn(async () => repository)
    const removeThirdPartyRepository = vi.fn(async () => undefined)
    const refreshThirdPartyRepository = vi.fn(async () => repository)
    const relinkInstallation = vi.fn(async () => undefined)
    registerIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      appStore: new AppStore(join(root, 'state.json')),
      services: {
        listThirdPartyRepositories,
        addThirdPartyRepository,
        updateThirdPartyRepository,
        removeThirdPartyRepository,
        refreshThirdPartyRepository,
        relinkInstallation,
      },
    })

    await expect(handlers.get(Channels.thirdPartyRepositoriesList)?.({}, undefined)).resolves.toEqual([repository])
    await expect(handlers.get(Channels.thirdPartyRepositoriesAdd)?.({}, { url: ` ${repository.url} ` })).resolves.toEqual(repository)
    await expect(handlers.get(Channels.thirdPartyRepositoriesUpdate)?.({}, { id: 'repo-1', input: { url: repository.url, branch: 'main' } })).resolves.toEqual(repository)
    await expect(handlers.get(Channels.thirdPartyRepositoriesRefresh)?.({}, 'repo-1')).resolves.toEqual(repository)
    await expect(handlers.get(Channels.thirdPartyRepositoriesRelinkInstallation)?.({}, { installationId: 'install-1', repositoryId: 'repo-1', assetId: 'asset-1' })).resolves.toBeUndefined()
    await expect(handlers.get(Channels.thirdPartyRepositoriesRemove)?.({}, 'repo-1')).resolves.toBeUndefined()
    expect(addThirdPartyRepository).toHaveBeenCalledWith({ url: repository.url })
    expect(updateThirdPartyRepository).toHaveBeenCalledWith('repo-1', { url: repository.url, branch: 'main' })
    expect(relinkInstallation).toHaveBeenCalledWith({ installationId: 'install-1', repositoryId: 'repo-1', assetId: 'asset-1' })
  })

  it('rejects unsafe third-party inputs before service handlers run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-third-party-invalid-'))
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>()
    const addThirdPartyRepository = vi.fn()
    const updateThirdPartyRepository = vi.fn()
    const relinkInstallation = vi.fn()
    registerIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      appStore: new AppStore(join(root, 'state.json')),
      services: { addThirdPartyRepository, updateThirdPartyRepository, relinkInstallation },
    })

    for (const input of [
      { url: 'file:///tmp/skill' },
      { url: 'https://token@example.com/skill.git' },
      { url: 'https://example.com/skill.git', branch: '../main' },
      { url: 'https://example.com/skill.git', cacheRoot: '/tmp/forged' },
    ]) {
      await expect(handlers.get(Channels.thirdPartyRepositoriesAdd)?.({}, input)).rejects.toThrow()
    }
    await expect(handlers.get(Channels.thirdPartyRepositoriesUpdate)?.({}, {
      id: '', input: { url: 'https://example.com/skill.git' },
    })).rejects.toThrow()
    await expect(handlers.get(Channels.thirdPartyRepositoriesRelinkInstallation)?.({}, {
      installationId: 'install-1', repositoryId: 'repo-1', assetId: 'asset-1', targetPath: '/tmp/forged',
    })).rejects.toThrow()
    expect(addThirdPartyRepository).not.toHaveBeenCalled()
    expect(updateThirdPartyRepository).not.toHaveBeenCalled()
    expect(relinkInstallation).not.toHaveBeenCalled()
  })

  it('returns the current repository capabilities through a read-only channel', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-repository-current-'))
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>()
    const currentRepository = vi.fn(async () => ({
      branch: 'main', kind: 'branch-cache' as const, allowSymlink: false, stale: false, cachedAt: null,
    }))
    registerIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      appStore: new AppStore(join(root, 'state.json')),
      services: { currentRepository },
    })

    await expect(handlers.get(Channels.repositoriesCurrent)?.({}, undefined)).resolves.toMatchObject({
      kind: 'branch-cache', allowSymlink: false,
    })
    expect(currentRepository).toHaveBeenCalledTimes(1)
  })

  it('chooses a local repository directory and returns null when selection is cancelled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-repository-picker-'))
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>()
    const showOpenDialog = vi.fn()
      .mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/catalog'] })
      .mockResolvedValueOnce({ canceled: true, filePaths: [] })
    registerIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      appStore: new AppStore(join(root, 'state.json')),
      dialog: { showOpenDialog },
    })

    expect(await handlers.get(Channels.repositoriesChooseLocalPath)?.({}, undefined)).toBe('/tmp/catalog')
    expect(await handlers.get(Channels.repositoriesChooseLocalPath)?.({}, undefined)).toBeNull()
    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openDirectory', 'createDirectory'],
    })
  })

  it('normalizes repository updates before invoking the service', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-repository-update-'))
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>()
    const updateConfig = vi.fn(async () => ({
      config: {
        mode: 'remote' as const,
        repoPath: '/tmp/catalog',
        remoteUrl: 'https://example.com/catalog.git',
        defaultBranch: 'main',
        defaultGroups: ['backend'],
      },
      repository: {
        branch: 'main',
        kind: 'branch-cache' as const,
        allowSymlink: false,
        stale: false,
        cachedAt: null,
      },
    }))
    registerIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      appStore: new AppStore(join(root, 'state.json')),
      services: { updateConfig },
    })

    const result = await handlers.get(Channels.repositoriesUpdateConfig)?.({}, {
      mode: 'remote',
      repoPath: '/tmp/catalog',
      remoteUrl: ' https://example.com/catalog.git ',
      defaultBranch: ' main ',
      defaultGroups: [' backend ', 'backend', ''],
    })

    expect(updateConfig).toHaveBeenCalledWith({
      mode: 'remote',
      repoPath: '/tmp/catalog',
      remoteUrl: 'https://example.com/catalog.git',
      defaultBranch: 'main',
      defaultGroups: ['backend'],
    })
    expect(result).toMatchObject({
      config: { mode: 'remote', defaultBranch: 'main' },
      repository: { branch: 'main', kind: 'branch-cache' },
    })
  })

  it('rejects invalid repository updates before invoking the service', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-repository-update-invalid-'))
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>()
    const updateConfig = vi.fn()
    registerIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      appStore: new AppStore(join(root, 'state.json')),
      services: { updateConfig },
    })

    await expect(handlers.get(Channels.repositoriesUpdateConfig)?.({}, {
      mode: 'remote',
      repoPath: '/tmp/catalog',
      remoteUrl: '',
      defaultBranch: 'main',
      defaultGroups: [],
    })).rejects.toThrow(/remote repository URL required/)
    expect(updateConfig).not.toHaveBeenCalled()
  })
})
