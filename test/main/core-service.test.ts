import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppStore } from '../../src/main/services/app-store.js'
import { CoreService } from '../../src/main/services/core-service.js'

describe('CoreService', () => {
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
})
