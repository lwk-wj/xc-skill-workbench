// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import ElementPlus from 'element-plus'
import { cleanup, render, screen, waitFor, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BatchOperationDialog from '../../src/renderer/src/features/operations/BatchOperationDialog.vue'
import { useBatchOperationStore } from '../../src/renderer/src/stores/batch-operation'
import type { AssetRecord, OperationPlan } from '../../src/shared/ipc.js'

const assets: AssetRecord[] = [
  { id: 'auto-type-mapper', type: 'skills', name: 'auto-type-mapper', group: 'backend', sourceRelativePath: 'backend/skills/auto-type-mapper', path: '/repo/auto-type-mapper', entryPath: '/repo/auto-type-mapper/SKILL.md', entryState: 'active', description: '', version: '1.0.0' },
  { id: 'call-api', type: 'skills', name: 'call-api', group: 'backend', sourceRelativePath: 'backend/skills/call-api', path: '/repo/call-api', entryPath: '/repo/call-api/SKILL.md', entryState: 'active', description: '', version: '1.0.0' },
]
const projects = [{ id: 'proj', name: 'Demo', path: '/project' }]
const agents = [
  { id: 'claude-code', name: 'Claude Code', projectBaseDir: '.claude', globalBaseDir: '/global/.claude', assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true },
  { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: '/global/.codex', assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true },
]
const makePlan = (request: any, index: number): OperationPlan => {
  const asset = assets.find((entry) => entry.id === request.asset.assetId)!
  const targetBase = request.target.scope === 'global' ? '/global' : '/project'
  const target = `${targetBase}/.${request.target.agentId}/skills/${asset.name}`
  return {
    id: `plan-${index}`, kind: request.kind, asset: { id: asset.id, name: asset.name, type: asset.type, path: asset.path },
    sourceBranch: 'main', sourceHash: 'hash', targetRoot: target.slice(0, target.lastIndexOf('/')), targetPath: target,
    method: request.method, steps: [{ kind: 'copy', source: asset.path, target }], warnings: [], requiresOverwriteConfirmation: false,
  }
}

describe('batch operation dialog', () => {
  let pinia: Pinia
  afterEach(cleanup)
  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
  })

  it('shows shared install configuration and a complete operation preview', async () => {
    const user = userEvent.setup()
    let index = 0
    window.xcSkills = { operations: {
      inspectSourceConflict: vi.fn().mockResolvedValue(null),
      plan: vi.fn().mockImplementation(async (request) => makePlan(request, ++index)),
      execute: vi.fn(), cancel: vi.fn(), onProgress: vi.fn(() => vi.fn()),
    } } as never
    const store = useBatchOperationStore()
    await store.open({ kind: 'install', items: assets.map((asset) => ({ asset, location: null })), source: { kind: 'central' }, projects, agents })

    render(BatchOperationDialog, { global: { plugins: [pinia, ElementPlus] } })

    const dialog = await screen.findByRole('dialog', { name: '批量安装资源' })
    expect(within(dialog).getByRole('combobox', { name: '目标范围' })).toBeInTheDocument()
    expect(within(dialog).getAllByRole('group', { name: '启用的 Agent' }).length).toBeGreaterThan(0)
    expect(within(dialog).getByRole('radiogroup', { name: '安装方式' })).toBeInTheDocument()
    expect(within(dialog).getByText('2 个资源 · 1 个 Agent · 2 项操作')).toBeInTheDocument()
    expect(store.scope).toBe('global')
    expect(store.selectedAgents).toEqual(['codex'])
    expect(store.method).toBe('symlink')
    expect(store.enabledAgents.map((agent) => agent.id)).toEqual(['codex', 'claude-code'])

    await user.click(within(dialog).getByRole('button', { name: '查看操作预览' }))
    expect(await within(dialog).findByRole('heading', { name: '受影响路径' })).toBeInTheDocument()
    expect(within(dialog).getByText('/global/.codex/skills/auto-type-mapper')).toBeInTheDocument()
    expect(within(dialog).getByText('操作将按列表顺序执行，首次失败后会停止。')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '确认执行' })).toBeEnabled()
  })

  it('shows a locked project target when installing from the project page', async () => {
    window.xcSkills = { operations: {
      inspectSourceConflict: vi.fn().mockResolvedValue(null),
      plan: vi.fn().mockImplementation(async (request) => makePlan(request, 1)),
      execute: vi.fn(), cancel: vi.fn(), onProgress: vi.fn(() => vi.fn()),
    } } as never
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

    render(BatchOperationDialog, { global: { plugins: [pinia, ElementPlus] } })

    const dialog = await screen.findByRole('dialog', { name: '批量安装资源' })
    expect(within(dialog).getByText('目标已锁定')).toBeInTheDocument()
    expect(within(dialog).getByText('Demo')).toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox', { name: '目标范围' })).toBeNull()
  })

  it('shows completed, failed, and not-run groups after stopping on an error', async () => {
    const user = userEvent.setup()
    let index = 0
    const execute = vi.fn()
      .mockResolvedValueOnce({ planId: 'plan-1', status: 'completed', affectedPaths: ['/done'], residualPaths: [] })
      .mockRejectedValueOnce(new Error('disk full'))
    window.xcSkills = { operations: {
      inspectSourceConflict: vi.fn().mockResolvedValue(null),
      plan: vi.fn().mockImplementation(async (request) => makePlan(request, ++index)),
      execute, cancel: vi.fn(), onProgress: vi.fn(() => vi.fn()),
    } } as never
    const store = useBatchOperationStore()
    await store.open({ kind: 'install', items: assets.map((asset) => ({ asset, location: null })), source: { kind: 'central' }, projects, agents })
    render(BatchOperationDialog, { global: { plugins: [pinia, ElementPlus] } })
    const dialog = await screen.findByRole('dialog', { name: '批量安装资源' })

    await user.click(within(dialog).getByRole('button', { name: '查看操作预览' }))
    await user.click(within(dialog).getByRole('button', { name: '确认执行' }))

    await waitFor(() => expect(within(dialog).getByRole('heading', { name: '已完成 1' })).toBeInTheDocument())
    expect(within(dialog).getByRole('heading', { name: '失败 1' })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: '未执行 0' })).toBeInTheDocument()
    expect(within(dialog).getByText('disk full')).toBeInTheDocument()
  })

  it('marks unmanaged deletion as irreversible before the final confirmation', async () => {
    const targetPath = '/global/.trae/skills/auto-type-mapper'
    const warning = `未托管资源：将直接删除磁盘安装位置 ${targetPath}，且无法通过 XC Skills 恢复。`
    window.xcSkills = { operations: {
      inspectSourceConflict: vi.fn().mockResolvedValue(null),
      plan: vi.fn().mockResolvedValue({
        ...makePlan({ kind: 'uninstall', asset: { assetId: 'auto-type-mapper' }, target: { agentId: 'trae' }, method: null }, 1),
        targetPath,
        steps: [{ kind: 'remove', source: '/repo/auto-type-mapper', target: targetPath }],
        warnings: [warning],
      }),
      execute: vi.fn(), cancel: vi.fn(), onProgress: vi.fn(() => vi.fn()),
    } } as never
    const store = useBatchOperationStore()
    await store.open({
      kind: 'uninstall',
      items: [{
        asset: assets[0]!,
        location: {
          projectId: null, agentId: 'trae', path: targetPath, method: 'copy', installationId: null,
          status: {
            status: 'source_unavailable', updateAvailable: false, locallyModified: false,
            sourceHash: null, installedHash: null, sourceVersion: null, installedVersion: null,
            resolvedTarget: targetPath, reason: '未受管资源',
          },
        },
      }],
      source: { kind: 'global' }, projects, agents: [{ ...agents[0]!, id: 'trae', name: 'Trae' }],
    })

    render(BatchOperationDialog, { global: { plugins: [pinia, ElementPlus] } })

    const dialog = await screen.findByRole('dialog', { name: '批量卸载资源' })
    expect(within(dialog).getByText(warning).closest('.el-alert')).toHaveClass('el-alert--error')
    expect(within(dialog).getByText('卸载会删除所有选中的安装位置，此操作不可逆。')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '确认执行' })).toHaveClass('el-button--danger')
  })

  it('explains that recoverable legacy resources will be upgraded before installation', async () => {
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
    window.xcSkills = {
      repositories: {
        previewSourceLayoutMigration: vi.fn().mockResolvedValue(preview),
        executeSourceLayoutMigration: vi.fn(),
      },
      operations: {
        inspectSourceConflict: vi.fn().mockResolvedValue(null),
        plan: vi.fn().mockImplementation(async (request) => makePlan(request, 1)),
        execute: vi.fn(), cancel: vi.fn(), onProgress: vi.fn(() => vi.fn()),
      },
    } as never
    const store = useBatchOperationStore()
    await store.open({ kind: 'install', items: [{ asset: assets[0]!, location: null }], source: { kind: 'central' }, projects, agents: [agents[0]!] })

    render(BatchOperationDialog, { global: { plugins: [pinia, ElementPlus] } })

    const dialog = await screen.findByRole('dialog', { name: '批量安装资源' })
    expect(within(dialog).getByText('安装前将自动恢复并升级 1 个旧版资源。')).toBeInTheDocument()
  })
})
