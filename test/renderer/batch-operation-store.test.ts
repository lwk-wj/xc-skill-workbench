// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBatchOperationStore } from '../../src/renderer/src/stores/batch-operation'
import type { AssetRecord, AssetStatusLocation, OperationPlan, OperationResult } from '../../src/shared/ipc.js'

const assets: AssetRecord[] = [
  { id: 'skill-one', type: 'skills', name: 'Skill One', group: 'backend', path: '/repo/skill-one', entryPath: '/repo/skill-one/SKILL.md', entryState: 'active', description: '', version: '1.0.0' },
  { id: 'skill-two', type: 'skills', name: 'Skill Two', group: 'backend', path: '/repo/skill-two', entryPath: '/repo/skill-two/SKILL.md', entryState: 'active', description: '', version: '1.0.0' },
]
const projects = [{ id: 'proj', name: 'Demo', path: '/project' }]
const agents = [
  { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: '/global/.codex', assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true },
  { id: 'claude-code', name: 'Claude Code', projectBaseDir: '.claude', globalBaseDir: '/global/.claude', assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true },
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

  it('plans every selected resource against the same project, agents, and method', async () => {
    const plan = vi.fn()
      .mockImplementation(async (request) => makePlan(`plan-${request.asset.assetId}-${request.target.agentId}`, assets.find((asset) => asset.id === request.asset.assetId), request.target.agentId))
    window.xcSkills = { operations: { inspectSourceConflict: vi.fn().mockResolvedValue(null), plan, execute: vi.fn(), cancel: vi.fn(), onProgress: vi.fn(() => vi.fn()) } } as never
    const store = useBatchOperationStore()

    await store.open({
      kind: 'install', items: assets.map((asset) => ({ asset, location: null })),
      source: { kind: 'central' }, projects, agents,
    })

    expect(store.scope).toBe('project')
    expect(plan.mock.calls.map(([request]) => request.target)).toEqual([
      { scope: 'project', projectId: 'proj', agentId: 'codex' },
      { scope: 'project', projectId: 'proj', agentId: 'claude-code' },
      { scope: 'project', projectId: 'proj', agentId: 'codex' },
      { scope: 'project', projectId: 'proj', agentId: 'claude-code' },
    ])
    expect(plan.mock.calls.every(([request]) => request.method === 'copy')).toBe(true)
    expect(store.planEntries.map((entry) => `${entry.asset.name}:${entry.agentName}`)).toEqual([
      'Skill One:Codex', 'Skill One:Claude Code', 'Skill Two:Codex', 'Skill Two:Claude Code',
    ])
    expect(store.canConfirm).toBe(true)
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
