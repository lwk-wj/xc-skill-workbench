// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useExplorerStore } from '../../src/renderer/src/stores/explorer'
import type { AssetRecord } from '../../src/shared/ipc.js'

const skill = {
  id: 'skill-one', type: 'skills', name: 'Skill One', group: '开发', path: '/tmp/skill-one', entryPath: '/tmp/skill-one/SKILL.md',
  entryState: 'active', description: 'first skill', version: '1.0.0',
} as const

describe('explorer store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.xcSkills = {
      projects: {
        list: vi.fn().mockResolvedValue([{ id: 'proj', name: 'Demo', path: '/tmp/demo' }]),
        chooseAndAdd: vi.fn(), remove: vi.fn(),
      },
      agents: {
        list: vi.fn().mockResolvedValue([
          { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: '/tmp/.codex', assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true },
        ]),
        saveCustom: vi.fn(), removeCustom: vi.fn(),
      },
      repositories: {
        listBranches: vi.fn().mockResolvedValue([{ name: 'main', current: true, default: true, remote: false }]),
        selectBranch: vi.fn().mockResolvedValue({ branch: 'main', kind: 'branch-cache', allowSymlink: true, stale: false, cachedAt: null }),
        setDefaultBranch: vi.fn(),
      },
      assets: { scan: vi.fn().mockResolvedValue([skill]) },
      preferences: { getLastSource: vi.fn().mockResolvedValue({ kind: 'central' }) },
    } as never
  })

  it('initializes sources, resolves Agent names, and resets filters on source change', async () => {
    const store = useExplorerStore()
    await store.initialize()

    expect(store.selectedSource.kind).toBe('central')
    expect(store.sources.map((source) => source.label)).toEqual(['中央仓库', '全局安装', 'Demo'])
    expect(store.agentName('codex')).toBe('Codex')
    expect(store.agentName('custom-agent')).toBe('custom-agent')
    expect(store.visibleAssets).toHaveLength(1)

    store.query = 'stale query'
    store.groupFilter = '开发'
    store.agentFilter = 'codex'
    await store.selectSource(store.sources.find((source) => source.kind === 'project')!)

    expect(store.query).toBe('')
    expect(store.groupFilter).toBe('all')
    expect(store.agentFilter).toBe('all')
    expect(window.xcSkills.assets.scan).toHaveBeenLastCalledWith({ kind: 'project', projectId: 'proj' })
  })

  it('ignores a slower scan after a newer source has finished', async () => {
    const pending: Array<(assets: AssetRecord[]) => void> = []
    vi.mocked(window.xcSkills.assets.scan).mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
    const store = useExplorerStore()
    const initialization = store.initialize()
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    pending.shift()!([skill])
    await initialization

    const globalScan = store.selectSource(store.sources.find((source) => source.kind === 'global')!)
    const projectScan = store.selectSource(store.sources.find((source) => source.kind === 'project')!)
    pending[1]!([{ ...skill, id: 'project-skill', name: 'Project Skill' }])
    await projectScan
    pending[0]!([{ ...skill, id: 'global-skill', name: 'Global Skill' }])
    await globalScan

    expect(store.assets.map((asset) => asset.name)).toEqual(['Project Skill'])
  })
})
