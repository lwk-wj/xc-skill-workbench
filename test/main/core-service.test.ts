import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppStore } from '../../src/main/services/app-store.js'
import { CoreService } from '../../src/main/services/core-service.js'

describe('CoreService', () => {
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
})
