import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink, lstat, readdir, cp } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../src/main/services/app-store.js'
import { CoreService } from '../../src/main/services/core-service.js'
import { hashAsset, scanAssets } from 'xc-skills/core'

describe('CoreService', () => {
  it('upgrades an empty legacy resource root before installing from its repositories directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-empty-legacy-root-'))
    const resourceRoot = join(root, 'resources')
    const repositoryRoot = join(resourceRoot, 'repositories', 'xcSkill', 'checkout')
    const skillRoot = join(repositoryRoot, 'skills', 'demo')
    const targetPath = join(root, 'agent', 'skills', 'demo')
    const configPath = join(root, 'config.json')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), '---\ndescription: Demo\n---\n\n# Demo\n')
    await writeFile(configPath, JSON.stringify({
      mode: 'remote', remoteUrl: 'https://example.com/skills.git', defaultBranch: 'main', assetStorePath: resourceRoot,
    }))
    const agent = {
      id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: join(root, 'agent'),
      assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true,
    }
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      configPath,
      core: {
        BUILTIN_AGENTS: [agent],
        resolveAgentAssetRoot: (_agent, _scope, _base, type) => join(root, 'agent', type),
        resolveRepositorySource: async () => ({
          root: repositoryRoot, branch: 'main', commit: 'a'.repeat(40), kind: 'branch-cache', allowSymlink: false, stale: false, cachedAt: null,
        }),
      },
    })

    const [asset] = await service.scan({ kind: 'central' })
    const plan = await service.plan({
      kind: 'install', asset: { source: { kind: 'central' }, assetId: asset!.id },
      target: { scope: 'global', agentId: 'codex' }, method: 'symlink',
    })
    await expect(service.execute(plan.id)).resolves.toMatchObject({ status: 'completed' })

    const config = JSON.parse(await readFile(configPath, 'utf8'))
    expect(config.assetStorePath).toBe(join(resourceRoot, 'store'))
    await expect(readFile(join(skillRoot, 'SKILL.md'), 'utf8')).resolves.toContain('# Demo')
    expect((await lstat(targetPath)).isSymbolicLink()).toBe(true)
    expect(await realpath(targetPath)).toContain('/resources/store/xcSkill/skills/demo')
    await rm(root, { recursive: true, force: true })
  })

  it('keeps remote checkouts below repositories while refresh leaves the managed store untouched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-repository-root-'))
    const resourceRoot = join(root, 'resources')
    const storeRoot = join(resourceRoot, 'store')
    const configPath = join(root, 'config.json')
    const entityFile = join(storeRoot, 'xcSkill', 'demo', 'SKILL.md')
    await mkdir(join(entityFile, '..'), { recursive: true })
    await writeFile(entityFile, '# installed version\n')
    await writeFile(configPath, JSON.stringify({
      mode: 'remote', remoteUrl: 'https://example.com/skills.git', defaultBranch: 'main', assetStorePath: storeRoot,
    }))
    const receivedCacheRoots: string[] = []
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      configPath,
      core: {
        resolveRepositorySource: async (_config, branch, cacheRoot) => {
          receivedCacheRoots.push(cacheRoot)
          return { root: join(cacheRoot, 'checkout'), branch, commit: 'a'.repeat(40), kind: 'branch-cache', allowSymlink: false, stale: false, cachedAt: null }
        },
      },
    })

    await service.currentRepository()
    await service.refresh()

    expect(receivedCacheRoots).toEqual([
      join(resourceRoot, 'repositories', 'xcSkill'),
      join(resourceRoot, 'repositories', 'xcSkill'),
    ])
    await expect(readFile(entityFile, 'utf8')).resolves.toBe('# installed version\n')
    await rm(root, { recursive: true, force: true })
  })

  it('keeps repository checkouts beside store when upgrading a legacy resource root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-legacy-resource-root-'))
    const resourceRoot = join(root, 'resources')
    const repositoriesRoot = join(resourceRoot, 'repositories')
    const repositoryMarker = join(repositoriesRoot, 'xcSkill', 'checkout', '.git-marker')
    const configPath = join(root, 'config.json')
    await mkdir(join(repositoryMarker, '..'), { recursive: true })
    await writeFile(repositoryMarker, 'keep repository checkout\n')
    await writeFile(configPath, JSON.stringify({
      mode: 'remote', remoteUrl: 'https://example.com/skills.git', defaultBranch: 'main', assetStorePath: resourceRoot,
    }))
    const thirdPartyRepositories = { invalidateSnapshots: vi.fn() }
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      configPath,
      thirdPartyRepositories: thirdPartyRepositories as never,
    })

    const preview = await service.previewAssetStoreMigration(join(resourceRoot, 'store'))
    expect(preview.conflicts).toEqual([])
    const migrated = await service.executeAssetStoreMigration(preview.token)

    expect(migrated.assetStorePath).toBe(join(resourceRoot, 'store'))
    await expect(readFile(repositoryMarker, 'utf8')).resolves.toBe('keep repository checkout\n')
    await expect(lstat(join(resourceRoot, 'store', 'repositories'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(thirdPartyRepositories.invalidateSnapshots).toHaveBeenCalledOnce()
    await rm(root, { recursive: true, force: true })
  })

  it('previews and executes repository-relative source layout migration with an opaque token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-source-layout-'))
    const repositoryRoot = join(root, 'repository')
    const skillRoot = join(repositoryRoot, 'backend', 'skills', 'demo')
    const storeRoot = join(root, 'store')
    const oldRelativePath = 'xcSkill/skills/backend/demo'
    const oldEntityPath = join(storeRoot, oldRelativePath)
    const targetPath = join(root, 'agent', 'skills', 'demo')
    const configPath = join(root, 'config.json')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), '---\ndescription: Demo\n---\n\n# Demo\n')
    await cp(skillRoot, oldEntityPath, { recursive: true })
    await mkdir(join(root, 'agent', 'skills'), { recursive: true })
    await symlink(oldEntityPath, targetPath)
    await writeFile(configPath, JSON.stringify({ mode: 'local', repoPath: repositoryRoot, defaultBranch: 'main', assetStorePath: storeRoot }))
    const [asset] = await scanAssets({ root: repositoryRoot })
    const contentHash = await hashAsset({ ...asset!, path: oldEntityPath, entryPath: join(oldEntityPath, 'SKILL.md') })
    const source = { kind: 'central' as const, id: repositoryRoot, name: '中央仓库', url: null }
    await writeFile(join(root, '.xc-skills-managed-assets.json'), JSON.stringify({
      version: 2,
      repositories: [{ sourceKind: 'central', sourceId: repositoryRoot, displayName: '中央仓库', directoryName: 'xcSkill' }],
      assets: [{
        id: '1'.repeat(64), source, asset: { type: 'skills', group: 'backend', name: 'demo', version: null },
        sourceBranch: 'main', installedCommit: null, contentHash, relativePath: oldRelativePath,
      }],
      installations: [{
        id: 'install-1', managedAssetId: '1'.repeat(64), scope: 'global', projectId: null, agentId: 'codex',
        targetPath, method: 'symlink', frozen: false, installedHash: contentHash,
      }],
    }))
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      configPath,
      cacheRoot: join(root, 'cache'),
      core: {
        resolveRepositorySource: async () => ({ root: repositoryRoot, branch: 'main', commit: 'a'.repeat(40), kind: 'local-worktree', allowSymlink: true, stale: false, cachedAt: null }),
      },
    })

    const preview = await service.previewSourceLayoutMigration()

    expect(preview).toMatchObject({
      moves: [{ fromRelativePath: oldRelativePath, toRelativePath: 'xcSkill/backend/skills/demo', sourceRelativePath: 'backend/skills/demo' }],
      unresolved: [], symlinkCount: 1, copyCount: 0, conflicts: [],
    })
    expect(preview).not.toHaveProperty('id')
    await service.executeSourceLayoutMigration(preview.token)
    const manifest = JSON.parse(await readFile(join(root, '.xc-skills-managed-assets.json'), 'utf8'))
    expect(manifest).toMatchObject({ version: 3, assets: [expect.objectContaining({ relativePath: 'xcSkill/backend/skills/demo', sourceRelativePath: 'backend/skills/demo' })] })
    expect(await realpath(targetPath)).toBe(await realpath(join(storeRoot, 'xcSkill', 'backend', 'skills', 'demo')))
    await rm(root, { recursive: true, force: true })
  })

  it('repairs an unresolved managed entity using a server-issued candidate token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-source-repair-'))
    const repositoryRoot = join(root, 'repository')
    const skillRoot = join(repositoryRoot, 'backend', 'skills', 'demo')
    const storeRoot = join(root, 'store')
    const oldRelativePath = 'xcSkill/skills/backend/demo'
    const oldEntityPath = join(storeRoot, oldRelativePath)
    const targetPath = join(root, 'agent', 'skills', 'demo')
    const configPath = join(root, 'config.json')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), '# Demo\n')
    await cp(skillRoot, oldEntityPath, { recursive: true })
    await mkdir(join(root, 'agent', 'skills'), { recursive: true })
    await symlink(oldEntityPath, targetPath)
    await writeFile(configPath, JSON.stringify({ mode: 'local', repoPath: repositoryRoot, defaultBranch: 'main', assetStorePath: storeRoot }))
    const [asset] = await scanAssets({ root: repositoryRoot })
    const contentHash = await hashAsset({ ...asset!, path: oldEntityPath, entryPath: join(oldEntityPath, 'SKILL.md') })
    const entityId = '2'.repeat(64)
    await writeFile(join(root, '.xc-skills-managed-assets.json'), JSON.stringify({
      version: 3,
      repositories: [{ sourceKind: 'central', sourceId: repositoryRoot, displayName: '中央仓库', directoryName: 'xcSkill' }],
      assets: [{
        id: entityId, source: { kind: 'central', id: repositoryRoot, name: '中央仓库', url: null },
        asset: { type: 'skills', group: 'backend', name: 'demo', version: null }, sourceBranch: 'main',
        installedCommit: null, contentHash, relativePath: oldRelativePath, sourceRelativePath: null,
      }],
      installations: [{
        id: 'install-1', managedAssetId: entityId, scope: 'global', projectId: null, agentId: 'codex',
        targetPath, method: 'symlink', frozen: false, installedHash: contentHash,
      }],
    }))
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      configPath,
      core: {
        resolveRepositorySource: async () => ({ root: repositoryRoot, branch: 'main', commit: 'a'.repeat(40), kind: 'local-worktree', allowSymlink: true, stale: false, cachedAt: null }),
      },
    })

    const preview = await service.previewManagedEntityRepair('install-1')

    expect(preview.candidates).toEqual([expect.objectContaining({ repositoryLabel: '中央仓库', sourceRelativePath: 'backend/skills/demo' })])
    const repaired = await service.executeManagedEntityRepair(preview.candidates[0]!.candidateToken)
    expect(repaired).toMatchObject({ installationId: 'install-1', fromRelativePath: oldRelativePath, toRelativePath: 'xcSkill/backend/skills/demo', rebuiltSymlinkCount: 1 })
    expect(await realpath(targetPath)).toBe(await realpath(join(storeRoot, 'xcSkill', 'backend', 'skills', 'demo')))
    await rm(root, { recursive: true, force: true })
  })

  it('does not expose the internal migration id in the IPC preview DTO', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-migration-preview-'))
    const configPath = join(root, 'config.json')
    await writeFile(configPath, JSON.stringify({
      mode: 'local',
      repoPath: join(root, 'repository'),
      defaultBranch: 'main',
      assetStorePath: join(root, 'old-store'),
    }))
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      configPath,
      cacheRoot: join(root, 'cache'),
    })

    const preview = await service.previewAssetStoreMigration(join(root, 'new-store'))

    expect(preview).not.toHaveProperty('id')
    expect(preview.token).toMatch(/^[A-Za-z0-9._:-]+$/)
    await rm(root, { recursive: true, force: true })
  })

  it('manages symlink install, update, and uninstall without offering freeze or thaw', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-managed-lifecycle-'))
    const repositoryRoot = join(root, 'repository')
    const skillRoot = join(repositoryRoot, 'skills', 'demo')
    const targetRoot = join(root, 'agent', 'skills')
    const assetStorePath = join(root, 'store')
    const configPath = join(root, 'config.json')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), '---\ndescription: Managed demo\n---\n\n# Demo\n')
    await writeFile(configPath, JSON.stringify({ mode: 'local', repoPath: repositoryRoot, defaultBranch: 'main', assetStorePath }))
    const agent = { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: join(root, 'agent'), assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true }
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      configPath,
      cacheRoot: join(root, 'cache'),
      core: {
        BUILTIN_AGENTS: [agent],
        resolveAgentAssetRoot: (_agent, _scope, _base, type) => join(root, 'agent', type),
        resolveRepositorySource: async () => ({ root: repositoryRoot, branch: 'main', commit: 'a'.repeat(40), kind: 'local-worktree', allowSymlink: true, stale: false, cachedAt: null }),
      },
    })

    const [catalogAsset] = await service.scan({ kind: 'central' })
    const installPlan = await service.plan({ kind: 'install', asset: { source: { kind: 'central' }, assetId: catalogAsset!.id }, target: { scope: 'global', agentId: 'codex' }, method: 'symlink' })
    await expect(service.execute(installPlan.id)).resolves.toMatchObject({ status: 'completed' })
    const targetPath = join(targetRoot, 'demo')
    expect((await lstat(targetPath)).isSymbolicLink()).toBe(true)
    expect(await realpath(targetPath)).toContain('/store/xcSkill/skills/demo')

    await writeFile(join(skillRoot, 'SKILL.md'), '---\ndescription: Managed demo v2\n---\n\n# Demo v2\n')
    const [refreshedAsset] = await service.scan({ kind: 'central' })
    const refreshedStatus = (await service.statuses({ source: { kind: 'central' }, assetId: refreshedAsset!.id }))
      .find((location) => location.path === targetPath)
    expect(refreshedStatus?.status).toMatchObject({ status: 'update_available', updateAvailable: true })
    expect(await readFile(join(targetPath, 'SKILL.md'), 'utf8')).toContain('# Demo\n')
    expect(await readFile(join(targetPath, 'SKILL.md'), 'utf8')).not.toContain('# Demo v2')

    const updatePlan = await service.plan({ kind: 'update', asset: { source: { kind: 'central' }, assetId: refreshedAsset!.id }, target: { scope: 'global', agentId: 'codex' }, method: 'copy' })
    expect(updatePlan.method).toBe('symlink')
    expect(updatePlan.warnings.join('\n')).toContain(targetPath)
    await service.execute(updatePlan.id)
    expect((await lstat(targetPath)).isSymbolicLink()).toBe(true)
    expect(await readFile(join(targetPath, 'SKILL.md'), 'utf8')).toContain('# Demo v2')
    const updatedManifest = JSON.parse(await readFile(join(root, '.xc-skills-managed-assets.json'), 'utf8'))
    expect(updatedManifest.assets).toHaveLength(1)
    expect(updatedManifest.installations).toHaveLength(1)

    const [installed] = await service.scan({ kind: 'global' })
    await expect(service.plan({ kind: 'freeze', asset: { source: { kind: 'global' }, assetId: installed!.id }, target: { scope: 'global', agentId: 'codex' }, method: null }))
      .rejects.toThrow('软链接资源不支持冻结')
    const uninstallPlan = await service.plan({ kind: 'uninstall', asset: { source: { kind: 'global' }, assetId: installed!.id }, target: { scope: 'global', agentId: 'codex' }, method: null })
    await service.execute(uninstallPlan.id)
    await expect(lstat(targetPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readdir(join(assetStorePath, 'xcSkill', 'skills')).catch(() => [])).resolves.toEqual([])
    await rm(root, { recursive: true, force: true })
  })

  it('allows an explicitly confirmed uninstall for an unmanaged frozen copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-unmanaged-uninstall-'))
    const targetRoot = join(root, 'agent', 'skills')
    const targetPath = join(root, 'agent', 'plugins', 'cache', 'third-party', 'skills', 'frontend-design')
    const entryPath = join(targetPath, 'SKILL.md.xc-disabled')
    const configPath = join(root, 'config.json')
    await mkdir(targetPath, { recursive: true })
    await writeFile(entryPath, '# Frontend design\n')
    await writeFile(configPath, JSON.stringify({
      mode: 'local', repoPath: join(root, 'repository'), defaultBranch: 'main', assetStorePath: join(root, 'store'),
    }))
    const agent = {
      id: 'trae', name: 'Trae', projectBaseDir: '.trae', globalBaseDir: join(root, 'agent'),
      assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true,
    }
    const scannedAsset = {
      id: 'skills::frontend-design', type: 'skills' as const, name: 'frontend-design', group: '',
      sourceRelativePath: 'skills/frontend-design', path: targetPath, entryPath, entryState: 'frozen' as const,
      description: 'Frontend design', version: null,
    }
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      configPath,
      core: {
        BUILTIN_AGENTS: [agent],
        resolveAgentAssetRoot: (_agent, _scope, _base, type) => join(root, 'agent', type),
        scanAssets: async ({ root: scanRoot }) => scanRoot === join(root, 'agent') ? [scannedAsset] : [],
      },
    })

    const [asset] = await service.scan({ kind: 'global' })
    const request = {
      asset: { source: { kind: 'global' as const }, assetId: asset!.id },
      target: { scope: 'global' as const, agentId: 'trae' },
      method: null,
    }

    await expect(service.plan({ ...request, kind: 'freeze' })).rejects.toThrow('this resource has not been migrated')
    const plan = await service.plan({ ...request, kind: 'uninstall' })
    expect(plan.warnings).toContain(`未托管资源：将直接删除磁盘安装位置 ${plan.targetPath}，且无法通过 XC Skills 恢复。`)

    await expect(service.execute(plan.id)).resolves.toMatchObject({ status: 'completed', affectedPaths: [plan.targetPath] })
    await expect(lstat(targetPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await rm(root, { recursive: true, force: true })
  })

  it('removes a stale managed installation when its symlink was deleted outside the app', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-missing-symlink-'))
    const repositoryRoot = join(root, 'repository')
    const skillRoot = join(repositoryRoot, 'skills', 'demo')
    const targetRoot = join(root, 'agent', 'skills')
    const configPath = join(root, 'config.json')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), '# Demo\n')
    await writeFile(configPath, JSON.stringify({ mode: 'local', repoPath: repositoryRoot, defaultBranch: 'main', assetStorePath: join(root, 'store') }))
    const agent = { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: join(root, 'agent'), assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true }
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      configPath,
      core: {
        BUILTIN_AGENTS: [agent],
        resolveAgentAssetRoot: (_agent, _scope, _base, type) => join(root, 'agent', type),
        resolveRepositorySource: async () => ({ root: repositoryRoot, branch: 'main', commit: 'a'.repeat(40), kind: 'local-worktree', allowSymlink: true, stale: false, cachedAt: null }),
      },
    })

    const [catalogAsset] = await service.scan({ kind: 'central' })
    const installPlan = await service.plan({ kind: 'install', asset: { source: { kind: 'central' }, assetId: catalogAsset!.id }, target: { scope: 'global', agentId: 'codex' }, method: 'symlink' })
    await service.execute(installPlan.id)
    await rm(join(targetRoot, 'demo'))

    await expect(service.scan({ kind: 'global' })).resolves.toEqual([])
    const manifest = JSON.parse(await readFile(join(root, '.xc-skills-managed-assets.json'), 'utf8'))
    expect(manifest.installations).toEqual([])
    await rm(root, { recursive: true, force: true })
  })

  it('reconciles missing project targets from a version 2 manifest before returning scan results', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-reconcile-v2-'))
    const projectRoot = join(root, 'project')
    const storeRoot = join(root, 'store')
    const entityId = '7'.repeat(64)
    const relativePath = 'xcSkill/skills/backend/demo'
    const entityPath = join(storeRoot, relativePath)
    const targetPath = join(projectRoot, '.codex', 'skills', 'demo')
    const configPath = join(root, 'config.json')
    await mkdir(projectRoot, { recursive: true })
    await mkdir(entityPath, { recursive: true })
    await writeFile(join(entityPath, 'SKILL.md'), '# Demo\n')
    await writeFile(configPath, JSON.stringify({ mode: 'local', repoPath: join(root, 'repository'), defaultBranch: 'main', assetStorePath: storeRoot }))
    await writeFile(join(root, '.xc-skills-managed-assets.json'), JSON.stringify({
      version: 2,
      repositories: [{ sourceKind: 'central', sourceId: 'central:catalog', displayName: '中央仓库', directoryName: 'xcSkill' }],
      assets: [{
        id: entityId,
        source: { kind: 'central', id: 'central:catalog', name: '中央仓库', url: null },
        asset: { type: 'skills', group: 'backend', name: 'demo', version: null },
        sourceBranch: 'main', installedCommit: null, contentHash: '6'.repeat(64), relativePath,
      }],
      installations: [{
        id: 'missing-project', managedAssetId: entityId, scope: 'project', projectId: 'project-1', agentId: 'codex',
        targetPath, method: 'symlink', frozen: false, installedHash: '6'.repeat(64),
      }],
    }))
    const appStore = new AppStore(join(root, 'state.json'))
    await appStore.addProject({ id: 'project-1', name: 'Project', path: projectRoot })
    const agent = { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: join(root, 'global', '.codex'), assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true }
    const service = new CoreService({
      appStore,
      configPath,
      core: {
        BUILTIN_AGENTS: [agent],
        resolveAgentAssetRoot: (_agent, _scope, base, type) => join(base, '.codex', type),
        scanAssets: async () => [],
      },
    })

    await expect(service.scan({ kind: 'project', projectId: 'project-1' })).resolves.toEqual([])
    await expect(readFile(join(root, '.xc-skills-managed-assets.json'), 'utf8').then(JSON.parse)).resolves.toMatchObject({
      version: 2,
      assets: [],
      installations: [],
    })
    await rm(root, { recursive: true, force: true })
  })

  it('requires confirmation before updating a locally modified managed copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-managed-copy-'))
    const repositoryRoot = join(root, 'repository')
    const skillRoot = join(repositoryRoot, 'skills', 'demo')
    const targetRoot = join(root, 'agent', 'skills')
    const configPath = join(root, 'config.json')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), '---\ndescription: Managed copy\n---\n\n# Repository\n')
    await writeFile(configPath, JSON.stringify({ mode: 'local', repoPath: repositoryRoot, defaultBranch: 'main', assetStorePath: join(root, 'store') }))
    const agent = { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: join(root, 'agent'), assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true }
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      configPath,
      cacheRoot: join(root, 'cache'),
      core: {
        BUILTIN_AGENTS: [agent],
        resolveAgentAssetRoot: (_agent, _scope, _base, type) => join(root, 'agent', type),
        resolveRepositorySource: async () => ({ root: repositoryRoot, branch: 'main', commit: 'a'.repeat(40), kind: 'local-worktree', allowSymlink: true, stale: false, cachedAt: null }),
      },
    })

    const [catalogAsset] = await service.scan({ kind: 'central' })
    const installPlan = await service.plan({ kind: 'install', asset: { source: { kind: 'central' }, assetId: catalogAsset!.id }, target: { scope: 'global', agentId: 'codex' }, method: 'copy' })
    await service.execute(installPlan.id)
    const targetPath = join(targetRoot, 'demo')
    await writeFile(join(targetPath, 'SKILL.md'), '# Local changes\n')
    const [installed] = await service.scan({ kind: 'global' })
    const updatePlan = await service.plan({ kind: 'update', asset: { source: { kind: 'global' }, assetId: installed!.id }, target: { scope: 'global', agentId: 'codex' }, method: 'copy', overwriteModified: false })

    expect(updatePlan.requiresOverwriteConfirmation).toBe(true)
    await rm(root, { recursive: true, force: true })
  })

  it('previews and transactionally migrates legacy installation records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-legacy-migration-'))
    const repositoryRoot = join(root, 'repository')
    const sourcePath = join(repositoryRoot, 'skills', 'demo')
    const targetPath = join(root, 'agent', 'skills', 'demo')
    const configPath = join(root, 'config.json')
    await mkdir(sourcePath, { recursive: true })
    await mkdir(targetPath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), '---\ndescription: Repository\n---\n\n# Repository\n')
    await writeFile(join(targetPath, 'SKILL.md'), '---\ndescription: Installed snapshot\n---\n\n# Installed snapshot\n')
    await writeFile(configPath, JSON.stringify({ mode: 'local', repoPath: repositoryRoot, defaultBranch: 'main', assetStorePath: join(root, 'store') }))
    const appStore = new AppStore(join(root, 'state.json'))
    await appStore.upsertInstallationSource({
      id: 'legacy-1', scope: 'global', projectId: null, agentId: 'codex', targetPath,
      asset: { type: 'skills', group: '', name: 'demo' },
      source: { kind: 'central', repositoryId: null, repositoryName: '中央仓库', repositoryUrl: null },
      installedCommit: null, installedHash: 'legacy-hash', method: 'symlink', frozen: false,
    })
    const agent = { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: join(root, 'agent'), assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true }
    const service = new CoreService({
      appStore,
      configPath,
      cacheRoot: join(root, 'cache'),
      core: {
        BUILTIN_AGENTS: [agent],
        resolveAgentAssetRoot: (_agent, _scope, _base, type) => join(root, 'agent', type),
        resolveRepositorySource: async () => ({ root: repositoryRoot, branch: 'main', commit: 'a'.repeat(40), kind: 'local-worktree', allowSymlink: true, stale: false, cachedAt: null }),
      },
    })

    const preview = await service.previewLegacyInstallationMigration()
    expect(preview).toMatchObject({
      candidates: [{ recordId: 'legacy-1', method: 'symlink', sourceLabel: '中央仓库' }],
      conflicts: [],
    })
    const remaining = await service.executeLegacyInstallationMigration(preview.token)

    expect(remaining.candidates).toEqual([])
    expect(await appStore.listInstallationSources()).toEqual([])
    expect((await lstat(targetPath)).isSymbolicLink()).toBe(true)
    expect(await readFile(join(targetPath, 'SKILL.md'), 'utf8')).toContain('# Installed snapshot')
    await expect(service.executeLegacyInstallationMigration(preview.token)).rejects.toThrow(/unknown or expired/)
    await rm(root, { recursive: true, force: true })
  })

  it('drops stale legacy installation records when the target no longer exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-stale-legacy-migration-'))
    const missingTargetPath = join(root, 'agent', 'skills', 'missing')
    const appStore = new AppStore(join(root, 'state.json'))
    await appStore.upsertInstallationSource({
      id: 'legacy-missing', scope: 'global', projectId: null, agentId: 'codex', targetPath: missingTargetPath,
      asset: { type: 'skills', group: '', name: 'missing' },
      source: { kind: 'central', repositoryId: null, repositoryName: '中央仓库', repositoryUrl: null },
      installedCommit: null, installedHash: 'legacy-hash', method: 'copy', frozen: false,
    })
    const service = new CoreService({
      appStore,
      configPath: join(root, 'config.json'),
      cacheRoot: join(root, 'cache'),
    })

    const preview = await service.previewLegacyInstallationMigration()

    expect(preview.candidates).toEqual([])
    expect(preview.conflicts).toEqual([])
    expect(await appStore.listInstallationSources()).toEqual([])
    await rm(root, { recursive: true, force: true })
  })

  it('exposes cached repository capabilities without forcing another resolution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-current-repository-'))
    const resolveRepositorySource = vi.fn(async () => ({
      root, branch: 'main', commit: 'a'.repeat(40), kind: 'branch-cache' as const, allowSymlink: false, stale: false, cachedAt: null,
    }))
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      configPath: join(root, 'config.json'),
      core: {
        readConfig: async () => ({ mode: 'remote', remoteUrl: 'https://example.com/catalog.git', defaultBranch: 'main' }),
        resolveRepositorySource,
      },
    })

    await expect(service.currentRepository()).resolves.toEqual({
      branch: 'main', commit: 'a'.repeat(40), kind: 'branch-cache', allowSymlink: false, stale: false, cachedAt: null,
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
      configPath: join(root, 'config.json'),
      core: {
        readConfig: async () => ({ mode: 'local', defaultBranch: 'main' }),
        resolveRepositorySource: async () => ({ root, branch: 'main', commit: 'a'.repeat(40), kind: 'local-worktree', allowSymlink: true, stale: false, cachedAt: null }),
      },
    })

    const [asset] = await service.scan({ kind: 'central' })
    const detail = await service.detail({ source: { kind: 'central' }, assetId: asset!.id })

    expect(detail.markdown).toContain('# Detail Skill')
    await rm(root, { recursive: true, force: true })
  })

  it('loads details for a managed Skill installed through a symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-symlink-detail-'))
    const repositoryRoot = join(root, 'repository')
    const storeRoot = join(root, 'store')
    const entityRelativePath = 'xcSkill/skills/frontend-design'
    const entityPath = join(storeRoot, entityRelativePath)
    const targetRoot = join(root, 'agent', 'skills')
    const targetPath = join(targetRoot, 'frontend-design')
    const configPath = join(root, 'config.json')
    const entityId = '3'.repeat(64)
    await mkdir(repositoryRoot, { recursive: true })
    await mkdir(entityPath, { recursive: true })
    await mkdir(targetRoot, { recursive: true })
    await writeFile(join(entityPath, 'SKILL.md'), '---\ndescription: Symlink detail\n---\n\n# Symlink Detail\n')
    await symlink(entityPath, targetPath)
    await writeFile(configPath, JSON.stringify({
      mode: 'local', repoPath: repositoryRoot, defaultBranch: 'main', assetStorePath: storeRoot,
    }))
    await writeFile(join(root, '.xc-skills-managed-assets.json'), JSON.stringify({
      version: 3,
      repositories: [{ sourceKind: 'central', sourceId: repositoryRoot, displayName: '中央仓库', directoryName: 'xcSkill' }],
      assets: [{
        id: entityId,
        source: { kind: 'central', id: repositoryRoot, name: '中央仓库', url: null },
        asset: { type: 'skills', group: '', name: 'frontend-design', version: null },
        sourceBranch: 'main', installedCommit: null, contentHash: '4'.repeat(64),
        relativePath: entityRelativePath, sourceRelativePath: 'skills/frontend-design',
      }],
      installations: [{
        id: 'install-1', managedAssetId: entityId, scope: 'global', projectId: null, agentId: 'codex',
        targetPath, method: 'symlink', frozen: false, installedHash: '4'.repeat(64),
      }],
    }))
    const agent = {
      id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: join(root, 'agent'),
      assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true,
    }
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      configPath,
      core: {
        BUILTIN_AGENTS: [agent],
        resolveAgentAssetRoot: (_agent, _scope, _base, type) => join(root, 'agent', type),
      },
    })

    const [asset] = await service.scan({ kind: 'global' })
    const detail = await service.detail({ source: { kind: 'global' }, assetId: asset!.id })

    expect(detail.markdown).toContain('# Symlink Detail')
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
      sourceRelativePath: 'backend/skills/call-api',
      path, entryPath: join(path, 'SKILL.md'), entryState: 'active' as const,
      description: 'API helper', version: '1.0.0',
    })
    const agents = [
      { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: join(root, 'codex'), assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true },
      { id: 'claude-code', name: 'Claude Code', projectBaseDir: '.claude', globalBaseDir: join(root, 'claude'), assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true },
    ]
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      configPath: join(root, 'config.json'),
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
    const service = new CoreService({ appStore: store, configPath, cacheRoot: join(root, 'cache'), chooseDirectory: async () => projectRoot, core: { resolveRepositorySource: async (_config, branch) => ({ root, branch, commit: 'a'.repeat(40), kind: 'local-worktree', allowSymlink: true, stale: false, cachedAt: null }) } })

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
            commit: 'a'.repeat(40),
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
      commit: 'a'.repeat(40),
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
          commit: 'a'.repeat(40),
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
          commit: 'a'.repeat(40),
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
      assetStorePath: join(homedir(), '.xc-skills', 'store'),
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
    const entry = (path: string) => ({ id: 'method-skill', type: 'skills' as const, name, group, sourceRelativePath: '开发/Method Skill', path, entryPath: join(path, 'SKILL.md'), entryState: 'active' as const, description: 'method test', version: '1.0.0' })
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
      configPath: join(root, 'config.json'),
      core: {
        BUILTIN_AGENTS: [agent],
        readConfig: async () => ({ mode: 'local', defaultBranch: 'main' }),
        resolveRepositorySource: async () => ({ root: centralRoot, branch: 'main', commit: 'a'.repeat(40), kind: 'local-worktree', allowSymlink: true, stale: false, cachedAt: null }),
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
      sourceRelativePath: 'backend/skills/call-api',
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
        resolveRepositorySource: async () => ({ root: centralRoot, branch: 'main', commit: 'a'.repeat(40), kind: 'local-worktree', allowSymlink: true, stale: false, cachedAt: null }),
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
      sourceRelativePath: 'backend/skills/call-api',
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
        resolveRepositorySource: async () => ({ root: centralRoot, branch: 'main', commit: 'a'.repeat(40), kind: 'local-worktree', allowSymlink: true, stale: false, cachedAt: null }),
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
    const asset = (id: string, group: string, path: string) => ({ id, type: 'skills' as const, name: 'call-api', group, sourceRelativePath: `${group || '_root'}/skills/call-api`, path, entryPath: join(path, 'SKILL.md'), entryState: 'active' as const, description: 'API helper', version: '1.0.0' })
    const centralAssets = [asset('backend-call-api', 'backend', join(centralRoot, 'backend', 'skills', 'call-api')), asset('common-call-api', 'common', join(centralRoot, 'common', 'skills', 'call-api'))]
    const installedAsset = asset('installed-call-api', '', installedPath)
    const agent = { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: join(root, 'global', '.codex'), assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true }
    const service = new CoreService({
      appStore: new AppStore(join(root, 'state.json')),
      core: {
        BUILTIN_AGENTS: [agent],
        readConfig: async () => ({ mode: 'local', defaultBranch: 'main' }),
        resolveRepositorySource: async () => ({ root: centralRoot, branch: 'main', commit: 'a'.repeat(40), kind: 'local-worktree', allowSymlink: true, stale: false, cachedAt: null }),
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
      await store.saveThirdPartyRepository({ id, name: id, url: `https://example.com/${id}.git`, branch: 'main', layout: 'catalog', skillRoots: [], createdAt: timestamp, lastFetchedAt: timestamp })
    }
    const rawAssets = new Map(['repo-1', 'repo-2'].map((id) => [id, {
      id: 'same-asset-id', type: 'skills' as const, name: 'shared-skill', group: 'common',
      sourceRelativePath: 'skills/common/shared-skill',
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
      sourceRelativePath: 'shared-skill',
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
    const repository = { id: 'repo-1', name: 'Team Skills', url: 'https://example.com/team.git', branch: 'main', layout: 'catalog' as const, skillRoots: [], createdAt: '2026-09-01T00:00:00.000Z', lastFetchedAt: '2026-09-01T01:00:00.000Z' }
    await store.saveThirdPartyRepository(repository)
    await store.upsertInstallationSource({
      id: 'install-1', scope: 'global', projectId: null, agentId: 'codex', targetPath,
      asset: { type: 'skills', group: '', name: 'demo' },
      source: { kind: 'central', repositoryId: null, repositoryName: 'Central', repositoryUrl: null },
      installedCommit: null, installedHash: 'same-hash',
    })
    const rawAsset = { id: 'asset-1', type: 'skills' as const, name: 'demo', group: '', sourceRelativePath: 'skills/demo', path: join(root, 'source', 'demo'), entryPath: join(root, 'source', 'demo', 'SKILL.md'), entryState: 'active' as const, description: 'Demo', version: null }
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

  it('records third-party provenance only after a completed install and removes it after uninstall', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-third-party-operation-'))
    const targetRoot = join(root, 'global', 'skills')
    const sourceRoot = join(root, 'source', 'demo')
    await mkdir(sourceRoot, { recursive: true })
    const store = new AppStore(join(root, 'state.json'))
    const repository = { id: 'repo-1', name: 'Team Skills', url: 'https://example.com/team.git', branch: 'main', layout: 'catalog' as const, skillRoots: [], createdAt: '2026-09-01T00:00:00.000Z', lastFetchedAt: '2026-09-01T01:00:00.000Z' }
    await store.saveThirdPartyRepository(repository)
    const rawAsset = { id: 'asset-1', type: 'skills' as const, name: 'demo', group: '', sourceRelativePath: 'skills/demo', path: sourceRoot, entryPath: join(sourceRoot, 'SKILL.md'), entryState: 'active' as const, description: 'Demo', version: null }
    const thirdPartyRepositories = { resolve: async () => ({ repository, root: join(root, 'source'), branch: 'main', commit: 'b'.repeat(40), layout: 'catalog' as const, stale: false, cachedAt: repository.lastFetchedAt, lastError: null, assets: [rawAsset], coreAssets: [rawAsset] }) }
    const agent = { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: join(root, 'global'), assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true }
    let resultStatus: 'completed' | 'rolled_back' = 'rolled_back'
    const planOperation = vi.fn(async ({ kind, asset }: { kind: string; asset: typeof rawAsset }) => ({
      id: `plan-${kind}`, kind, asset, sourceBranch: 'main', sourceHash: 'source-hash', targetRoot,
      targetPath: join(targetRoot, asset.name), method: kind === 'install' ? 'copy' : null,
      steps: [], warnings: [], requiresOverwriteConfirmation: false,
    }))
    const service = new CoreService({
      appStore: store,
      thirdPartyRepositories: thirdPartyRepositories as never,
      core: {
        BUILTIN_AGENTS: [agent],
        resolveAgentAssetRoot: () => targetRoot,
        planOperation: planOperation as never,
        executeOperation: async (plan: { id: string; targetPath: string }) => ({ planId: plan.id, status: resultStatus, affectedPaths: [plan.targetPath], residualPaths: [] }),
        evaluateAssetStatus: async () => ({ status: 'current', updateAvailable: false, locallyModified: false, sourceHash: 'source-hash', installedHash: 'installed-hash', sourceVersion: null, installedVersion: null, resolvedTarget: join(targetRoot, 'demo'), reason: 'current' }),
      },
    })
    const [asset] = await service.scan({ kind: 'third-party', repositoryId: 'repo-1' })
    const request = { kind: 'install' as const, asset: { source: { kind: 'third-party' as const, repositoryId: 'repo-1' }, assetId: asset!.id }, target: { scope: 'global' as const, agentId: 'codex' }, method: 'copy' as const }

    const rolledBackPlan = await service.plan(request)
    await service.execute(rolledBackPlan.id)
    await expect(store.listInstallationSources()).resolves.toEqual([])

    resultStatus = 'completed'
    const completedPlan = await service.plan(request)
    await service.execute(completedPlan.id)
    await expect(store.listInstallationSources()).resolves.toMatchObject([{
      source: { kind: 'third-party', repositoryId: 'repo-1' }, installedCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', installedHash: 'installed-hash',
    }])

    const installed = { ...rawAsset, id: 'installed', path: join(targetRoot, 'demo'), entryPath: join(targetRoot, 'demo', 'SKILL.md') }
    ;(service as unknown as { catalog: Map<string, unknown> }).catalog.set(`${JSON.stringify({ kind: 'global' })}:${installed.id}`, installed)
    ;(service as unknown as { coreCatalog: Map<string, unknown> }).coreCatalog.set(`${JSON.stringify({ kind: 'global' })}:${installed.id}`, installed)
    ;(service as unknown as { metadata: Map<string, unknown> }).metadata.set(`${JSON.stringify({ kind: 'global' })}:${installed.id}`, { source: { kind: 'global' }, projectId: null, agentId: 'codex', method: null })
    const uninstallPlan = await service.plan({ kind: 'uninstall', asset: { source: { kind: 'global' }, assetId: installed.id }, target: { scope: 'global', agentId: 'codex' }, method: null })
    await service.execute(uninstallPlan.id)
    await expect(store.listInstallationSources()).resolves.toEqual([])
    await rm(root, { recursive: true, force: true })
  })

  it('blocks a different-source target unless replacement is explicit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xc-desktop-source-conflict-'))
    const targetRoot = join(root, 'global', 'skills')
    const targetPath = join(targetRoot, 'demo')
    await mkdir(targetPath, { recursive: true })
    const store = new AppStore(join(root, 'state.json'))
    const repository = { id: 'repo-1', name: 'Team Skills', url: 'https://example.com/team.git', branch: 'main', layout: 'catalog' as const, skillRoots: [], createdAt: '2026-09-01T00:00:00.000Z', lastFetchedAt: null }
    await store.saveThirdPartyRepository(repository)
    await store.upsertInstallationSource({ id: 'install-1', scope: 'global', projectId: null, agentId: 'codex', targetPath, asset: { type: 'skills', group: '', name: 'demo' }, source: { kind: 'central', repositoryId: null, repositoryName: '中央仓库', repositoryUrl: null }, installedCommit: null, installedHash: 'old' })
    const rawAsset = { id: 'asset-1', type: 'skills' as const, name: 'demo', group: '', sourceRelativePath: 'skills/demo', path: join(root, 'source'), entryPath: join(root, 'source', 'SKILL.md'), entryState: 'active' as const, description: 'Demo', version: null }
    const service = new CoreService({
      appStore: store,
      thirdPartyRepositories: { resolve: async () => ({ repository, root: rawAsset.path, branch: 'main', commit: 'a'.repeat(40), layout: 'catalog', stale: false, cachedAt: null, lastError: null, assets: [rawAsset], coreAssets: [rawAsset] }) } as never,
      core: {
        BUILTIN_AGENTS: [{ id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: join(root, 'global'), assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true }],
        resolveAgentAssetRoot: () => targetRoot,
        planOperation: async ({ kind, asset }) => ({ id: 'plan-replace', kind, asset, sourceBranch: 'main', sourceHash: 'new', targetRoot, targetPath, method: 'copy', steps: [], warnings: [], requiresOverwriteConfirmation: false }),
      },
    })
    const [asset] = await service.scan({ kind: 'third-party', repositoryId: 'repo-1' })
    const request = { kind: 'install' as const, asset: { source: { kind: 'third-party' as const, repositoryId: 'repo-1' }, assetId: asset!.id }, target: { scope: 'global' as const, agentId: 'codex' }, method: 'copy' as const }

    await expect(service.inspectSourceConflict(request)).resolves.toMatchObject({
      targetPath: await realpath(targetPath),
      existing: { kind: 'central', label: '中央仓库' },
      requested: { kind: 'third-party', repositoryId: 'repo-1', label: 'Team Skills' },
    })
    await expect(service.plan(request)).rejects.toThrow(/ENTRY_CONFLICT/)
    await expect(service.plan({ ...request, replaceExistingSource: true })).resolves.toMatchObject({ warnings: expect.arrayContaining([expect.stringMatching(/替换/)]) })
    await rm(root, { recursive: true, force: true })
  })
})
