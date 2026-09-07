// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBatchOperationStore } from '../../src/renderer/src/stores/batch-operation'
import type { AssetRecord, AssetStatusLocation, OperationPlan, OperationResult } from '../../src/shared/ipc.js'

const assets: AssetRecord[] = [
  { id: 'skill-one', type: 'skills', name: 'Skill One', group: 'backend', sourceRelativePath: 'backend/skills/skill-one', path: '/repo/skill-one', entryPath: '/repo/skill-one/SKILL.md', entryState: 'active', description: '', version: '1.0.0' },
  { id: 'skill-two', type: 'skills', name: 'Skill Two', group: 'backend', sourceRelativePath: 'backend/skills/skill-two', path: '/repo/skill-two', entryPath: '/repo/skill-two/SKILL.md', entryState: 'active', description: '', version: '1.0.0' },
]
const projects = [{ id: 'proj', name: 'Demo', path: '/project' }]
const agents = [
  { id: 'claude-code', name: 'Claude Code', projectBaseDir: '.claude', globalBaseDir: '/global/.claude', assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true },
  { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: '/global/.codex', assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true },
]

const makePlan = (id: string, asset = assets[0]!, agentId = 'codex'): OperationPlan => ({
  id,
  kind: 'install',
  asset: { id: asset.id, name: asset.name, type: asset.type, path: asset.path },
  sourceBranch: 'main',
  sourceHash: `hash-${asset.id}`,
  targetRoot: `/project/.${agentId}/skills`,
  targetPath: `/project/.${agentId}/skills/${asset.name}`,
  method: 'copy',
  steps: [{ kind: 'copy', source: asset.path, target: `/project/.${agentId}/skills/${asset.name}` }],
  warnings: [],
  requiresOverwriteConfirmation: false,
})

const currentStatus = (): AssetStatusLocation['status'] => ({
  status: 'current', updateAvailable: false, locallyModified: false,
  sourceHash: 'hash', installedHash: 'hash', sourceVersion: '1.0.0', installedVersion: '1.0.0',
  resolvedTarget: null, reason: '',
})

describe('batch operation store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('defaults batch installs to global Codex symlinks and orders Codex first', async () => {
    const plan = vi.fn()
      .mockImplementation(async (request) => makePlan(`plan-${request.asset.assetId}-${request.target.agentId}`, assets.find((asset) => asset.id === request.asset.assetId), request.target.agentId))
    window.xcSkills = { operations: { inspectSourceConflict: vi.fn().mockResolvedValue(null), plan, execute: vi.fn(), cancel: vi.fn(), onProgress: vi.fn(() => vi.fn()) } } as never
    const store = useBatchOperationStore()

    await store.open({
      kind: 'install', items: assets.map((asset) => ({ asset, location: null })),
      source: { kind: 'central' }, projects, agents,
    })

    expect(store.scope).toBe('global')
    expect(store.selectedAgents).toEqual(['codex'])
    expect(store.method).toBe('symlink')
    expect(store.enabledAgents.map((agent) => agent.id)).toEqual(['codex', 'claude-code'])
    expect(plan.mock.calls.map(([request]) => request.target)).toEqual([
      { scope: 'global', agentId: 'codex' },
      { scope: 'global', agentId: 'codex' },
    ])
    expect(plan.mock.calls.every(([request]) => request.method === 'symlink')).toBe(true)
    expect(store.planEntries.map((entry) => `${entry.asset.name}:${entry.agentName}`)).toEqual([
      'Skill One:Codex', 'Skill Two:Codex',
    ])
    expect(store.canConfirm).toBe(true)
  })

  it('can lock batch installs to the current project target', async () => {
    const plan = vi.fn()
      .mockImplementation(async (request) => makePlan(`plan-${request.asset.assetId}-${request.target.agentId}`, assets.find((asset) => asset.id === request.asset.assetId), request.target.agentId))
    window.xcSkills = { operations: { inspectSourceConflict: vi.fn().mockResolvedValue(null), plan, execute: vi.fn(), cancel: vi.fn(), onProgress: vi.fn(() => vi.fn()) } } as never
    const store = useBatchOperationStore()

    await store.open({
      kind: 'install',
      items: [{ asset: assets[0]!, location: null }],
      source: { kind: 'central' },
      projects,
      agents,
      defaultScope: 'project',
      defaultProjectId: 'proj',
      lockTarget: true,
    })

    expect(store.scope).toBe('project')
    expect(store.projectId).toBe('proj')
    expect(store.targetLocked).toBe(true)
    expect(store.targetLabel).toBe('Demo')
    expect(plan).toHaveBeenCalledWith(expect.objectContaining({
      target: { scope: 'project', projectId: 'proj', agentId: 'codex' },
      method: 'symlink',
    }))
  })

  it('uses exact installed locations and blocks confirmation when one is missing', async () => {
    const firstLocation: AssetStatusLocation = { projectId: 'proj', agentId: 'codex', path: '/project/.codex/skills/Skill One', method: 'copy', status: currentStatus() }
    const plan = vi.fn().mockResolvedValue({ ...makePlan('freeze-one'), kind: 'freeze', method: null })
    window.xcSkills = { operations: { plan, execute: vi.fn(), cancel: vi.fn(), onProgress: vi.fn(() => vi.fn()) } } as never
    const store = useBatchOperationStore()

    await store.open({
      kind: 'freeze', items: [{ asset: assets[0]!, location: firstLocation }, { asset: assets[1]!, location: null }],
      source: { kind: 'project', projectId: 'proj' }, projects, agents,
    })

    expect(plan).toHaveBeenCalledWith(expect.objectContaining({
      target: { scope: 'project', projectId: 'proj', agentId: 'codex' }, method: null,
    }))
    expect(store.planEntries[1]?.planningError).toBe('缺少受管安装位置')
    expect(store.canConfirm).toBe(false)
  })

  it('stops on the first execution error and rescans only completed affected paths', async () => {
    const thirdAsset = { ...assets[1]!, id: 'skill-three', name: 'Skill Three', path: '/repo/skill-three', entryPath: '/repo/skill-three/SKILL.md' }
    const plans = [makePlan('plan-1'), makePlan('plan-2', assets[1]), makePlan('plan-3', thirdAsset)]
    const plan = vi.fn().mockResolvedValueOnce(plans[0]).mockResolvedValueOnce(plans[1]).mockResolvedValueOnce(plans[2])
    const execute = vi.fn()
      .mockResolvedValueOnce({ planId: 'plan-1', status: 'completed', affectedPaths: ['/done', '/done'], residualPaths: [] } satisfies OperationResult)
      .mockRejectedValueOnce(new Error('disk full'))
    window.xcSkills = { operations: { inspectSourceConflict: vi.fn().mockResolvedValue(null), plan, execute, cancel: vi.fn(), onProgress: vi.fn(() => vi.fn()) } } as never
    const onRescan = vi.fn()
    const store = useBatchOperationStore()
    await store.open({ kind: 'install', items: [assets[0]!, assets[1]!, thirdAsset].map((asset) => ({ asset, location: null })), source: { kind: 'central' }, projects, agents: [agents[0]!], onRescan })
    store.confirmPreview()
    store.confirmExecution()

    await store.executeAll()

    expect(execute.mock.calls.map(([planId]) => planId)).toEqual(['plan-1', 'plan-2'])
    expect(store.executionEntries.map((entry) => entry.status)).toEqual(['completed', 'failed', 'not_run'])
    expect(store.executionEntries[1]?.error).toBe('disk full')
    expect(store.stage).toBe('done')
    expect(onRescan).toHaveBeenCalledOnce()
    expect(onRescan).toHaveBeenCalledWith(['/done'])
  })

  it('migrates a recoverable version 2 store before executing the first batch installation', async () => {
    const events: string[] = []
    const preview = {
      token: 'migration-token',
      moves: [{
        entityId: 'old-entity',
        fromRelativePath: 'xcSkill/skills/common/demo',
        toRelativePath: 'xcSkill/skills/demo',
        sourceRelativePath: 'skills/demo',
      }],
      unresolved: [],
      symlinkCount: 0,
      copyCount: 1,
      conflicts: [],
      expiresAt: '2026-09-04T04:00:00.000Z',
    }
    const plan = vi.fn().mockResolvedValue(makePlan('plan-1'))
    const executeSourceLayoutMigration = vi.fn().mockImplementation(async () => {
      events.push('migration')
      return { ...preview, token: 'complete-token', moves: [] }
    })
    const execute = vi.fn().mockImplementation(async () => {
      events.push('installation')
      return { planId: 'plan-1', status: 'completed', affectedPaths: ['/done'], residualPaths: [] } satisfies OperationResult
    })
    window.xcSkills = {
      repositories: {
        previewSourceLayoutMigration: vi.fn().mockResolvedValue(preview),
        executeSourceLayoutMigration,
      },
      operations: {
        inspectSourceConflict: vi.fn().mockResolvedValue(null),
        plan,
        execute,
        cancel: vi.fn(),
        onProgress: vi.fn(() => vi.fn()),
      },
    } as never
    const store = useBatchOperationStore()
    await store.open({ kind: 'install', items: [{ asset: assets[0]!, location: null }], source: { kind: 'central' }, projects, agents: [agents[0]!] })
    store.confirmPreview()
    store.confirmExecution()

    await store.executeAll()

    expect(events).toEqual(['migration', 'installation'])
    expect(executeSourceLayoutMigration).toHaveBeenCalledWith('migration-token')
    expect(store.executionEntries[0]?.status).toBe('completed')
  })

  it('blocks batch confirmation when the managed store migration cannot be checked', async () => {
    window.xcSkills = {
      repositories: {
        previewSourceLayoutMigration: vi.fn().mockRejectedValue(new Error('仓库不可访问')),
      },
      operations: {
        inspectSourceConflict: vi.fn().mockResolvedValue(null),
        plan: vi.fn().mockResolvedValue(makePlan('plan-1')),
        execute: vi.fn(), cancel: vi.fn(), onProgress: vi.fn(() => vi.fn()),
      },
    } as never
    const store = useBatchOperationStore()

    await store.open({ kind: 'install', items: [{ asset: assets[0]!, location: null }], source: { kind: 'central' }, projects, agents: [agents[0]!] })

    expect(store.error).toBe('仓库不可访问')
    expect(store.canConfirm).toBe(false)
  })

  it('cancels only the active plan and leaves the remaining plans unexecuted', async () => {
    const plans = [makePlan('plan-1'), makePlan('plan-2', assets[1])]
    const plan = vi.fn().mockResolvedValueOnce(plans[0]).mockResolvedValueOnce(plans[1])
    let resolveExecute!: (result: OperationResult) => void
    const execute = vi.fn(() => new Promise<OperationResult>((resolve) => { resolveExecute = resolve }))
    const cancel = vi.fn().mockResolvedValue(undefined)
    window.xcSkills = { operations: { inspectSourceConflict: vi.fn().mockResolvedValue(null), plan, execute, cancel, onProgress: vi.fn(() => vi.fn()) } } as never
    const store = useBatchOperationStore()
    await store.open({ kind: 'install', items: assets.map((asset) => ({ asset, location: null })), source: { kind: 'central' }, projects, agents: [agents[0]!] })
    store.confirmPreview()
    store.confirmExecution()
    const execution = store.executeAll()
    await vi.waitFor(() => expect(execute).toHaveBeenCalledWith('plan-1'))

    await store.cancelActive()
    expect(cancel).toHaveBeenCalledWith('plan-1')
    expect(store.stage).toBe('executing')
    resolveExecute({ planId: 'plan-1', status: 'cancelled', affectedPaths: [], residualPaths: ['/pending'] })
    await execution

    expect(execute).toHaveBeenCalledTimes(1)
    expect(store.executionEntries.map((entry) => entry.status)).toEqual(['cancelled', 'not_run'])
    expect(store.stage).toBe('done')
  })
})
