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
  { id: 'auto-type-mapper', type: 'skills', name: 'auto-type-mapper', group: 'backend', path: '/repo/auto-type-mapper', entryPath: '/repo/auto-type-mapper/SKILL.md', entryState: 'active', description: '', version: '1.0.0' },
  { id: 'call-api', type: 'skills', name: 'call-api', group: 'backend', path: '/repo/call-api', entryPath: '/repo/call-api/SKILL.md', entryState: 'active', description: '', version: '1.0.0' },
]
const projects = [{ id: 'proj', name: 'Demo', path: '/project' }]
const agents = [
  { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: '/global/.codex', assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true },
  { id: 'claude-code', name: 'Claude Code', projectBaseDir: '.claude', globalBaseDir: '/global/.claude', assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true },
]
const makePlan = (request: any, index: number): OperationPlan => {
  const asset = assets.find((entry) => entry.id === request.asset.assetId)!
  const target = `/project/.${request.target.agentId}/skills/${asset.name}`
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
    expect(within(dialog).getByText('2 个资源 · 2 个 Agent · 4 项操作')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '查看操作预览' }))
    expect(await within(dialog).findByRole('heading', { name: '受影响路径' })).toBeInTheDocument()
    expect(within(dialog).getByText('/project/.codex/skills/auto-type-mapper')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '确认并继续' })).toBeEnabled()
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
    await user.click(within(dialog).getByRole('button', { name: '确认并继续' }))
    await user.click(within(dialog).getByRole('button', { name: '确认执行' }))

    await waitFor(() => expect(within(dialog).getByRole('heading', { name: '已完成 1' })).toBeInTheDocument())
    expect(within(dialog).getByRole('heading', { name: '失败 1' })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: '未执行 2' })).toBeInTheDocument()
    expect(within(dialog).getByText('disk full')).toBeInTheDocument()
  })
})
