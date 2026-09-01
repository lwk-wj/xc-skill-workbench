// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import ElementPlus from 'element-plus'
import { cleanup, render, screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isProxy } from 'vue'
import OperationDialog from '../../src/renderer/src/features/operations/OperationDialog.vue'
import { useOperationStore } from '../../src/renderer/src/stores/operation'
import type { OperationPlan, OperationProgress } from '../../src/shared/ipc.js'

const asset = { id: 'codex:skill-one', type: 'skills' as const, name: 'Skill One', group: '开发', path: '/project/.codex/skills/Skill One', entryPath: '/project/.codex/skills/Skill One/SKILL.md', entryState: 'active' as const, description: '', version: '1.0.0', agentId: 'codex' }
const projects = [{ id: 'proj', name: 'Demo', path: '/project' }]
const agents = [
  { id: 'codex', name: 'Codex', projectBaseDir: '/project/.codex', globalBaseDir: '/global/.codex', assetDirs: { skills: '/global/.codex/skills', rules: '/global/.codex/rules', workflows: '/global/.codex/workflows' }, builtIn: true, enabled: true },
  { id: 'claude-code', name: 'Claude Code', projectBaseDir: '/project/.claude', globalBaseDir: '/global/.claude', assetDirs: { skills: '/global/.claude/skills', rules: '/global/.claude/rules', workflows: '/global/.claude/workflows' }, builtIn: true, enabled: true },
]

const makePlan = (id: string, targetPath: string, overwrite = false): OperationPlan => ({
  id, kind: 'install', asset: { id: asset.id, name: asset.name, type: asset.type, path: asset.path }, sourceBranch: 'main', sourceHash: 'hash',
  targetRoot: targetPath.slice(0, targetPath.lastIndexOf('/')), targetPath, method: 'copy',
  steps: [{ kind: 'copy', source: asset.path, target: targetPath }], warnings: overwrite ? ['本地有修改'] : [], requiresOverwriteConfirmation: overwrite,
})

describe('Vue operation dialog', () => {
  let pinia: Pinia
  afterEach(cleanup)
  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
  })

  it('plans qualified multi-Agent targets, executes sequentially, rescans, and disposes progress', async () => {
    const user = userEvent.setup()
    const plans = [makePlan('plan-codex', '/project/.codex/skills/Skill One'), makePlan('plan-claude', '/project/.claude/skills/Skill One')]
    const plan = vi.fn().mockResolvedValueOnce(plans[0]).mockResolvedValueOnce(plans[1])
    const execute = vi.fn()
      .mockResolvedValueOnce({ planId: 'plan-codex', status: 'completed', affectedPaths: [plans[0]!.targetPath], residualPaths: [] })
      .mockResolvedValueOnce({ planId: 'plan-claude', status: 'completed', affectedPaths: [plans[1]!.targetPath], residualPaths: [] })
    const dispose = vi.fn()
    let progressListener: ((progress: OperationProgress) => void) | undefined
    const onProgress = vi.fn((listener) => { progressListener = listener; return dispose })
    window.xcSkills = { operations: { plan, execute, cancel: vi.fn(), onProgress } } as never
    const onRescan = vi.fn()
    const store = useOperationStore()
    await store.open({ kind: 'install', asset, source: { kind: 'project', projectId: 'proj' }, projects, agents, scope: 'project', projectId: 'proj', onRescan })

    expect(plan).toHaveBeenLastCalledWith(expect.objectContaining({
      asset: { source: { kind: 'project', projectId: 'proj' }, assetId: 'codex:skill-one' },
      target: { scope: 'project', projectId: 'proj', agentId: 'claude-code' },
    }))
    expect(isProxy(plan.mock.calls.at(-1)?.[0].asset.source)).toBe(false)
    render(OperationDialog, { global: { plugins: [pinia, ElementPlus] } })
    await waitFor(() => expect(screen.getByText('/project/.codex/skills/Skill One')).toBeInTheDocument())
    expect(screen.getByText('/project/.claude/skills/Skill One')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认并继续' }))
    expect(execute).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '确认执行' }))
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
    expect(execute.mock.calls.map(([id]) => id)).toEqual(['plan-codex', 'plan-claude'])
    expect(onRescan).toHaveBeenCalledTimes(2)
    progressListener?.({ planId: 'plan-claude', completed: 1, total: 1, message: '完成' })
    await user.click(screen.getByRole('button', { name: '完成' }))
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('uses the exact installed location and can cancel the active plan', async () => {
    const user = userEvent.setup()
    const operationPlan = { ...makePlan('plan-update', '/project/.codex/skills/Skill One', true), kind: 'update' as const }
    const plan = vi.fn().mockResolvedValue(operationPlan)
    let resolveExecute!: (result: { planId: string; status: 'cancelled'; affectedPaths: string[]; residualPaths: string[] }) => void
    const execute = vi.fn(() => new Promise((resolve) => { resolveExecute = resolve }))
    const cancel = vi.fn().mockResolvedValue(undefined)
    window.xcSkills = { operations: { plan, execute, cancel, onProgress: vi.fn(() => vi.fn()) } } as never
    const store = useOperationStore()
    await store.open({
      kind: 'update', asset, source: { kind: 'project', projectId: 'proj' }, projects, agents,
      location: { projectId: 'proj', agentId: 'codex', path: '/project/.codex/skills/Skill One' },
    })
    expect(plan).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'update',
      asset: { source: { kind: 'project', projectId: 'proj' }, assetId: 'codex:skill-one' },
      target: { scope: 'project', projectId: 'proj', agentId: 'codex' },
    }))
    render(OperationDialog, { global: { plugins: [pinia, ElementPlus] } })
    await waitFor(() => expect(screen.getByRole('button', { name: '确认并继续' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '确认并继续' }))
    await user.click(screen.getByRole('button', { name: '确认执行' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '取消操作' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '取消操作' }))
    expect(cancel).toHaveBeenCalledWith('plan-update')
    resolveExecute({ planId: 'plan-update', status: 'cancelled', affectedPaths: [], residualPaths: ['/project/.codex/skills/Skill One'] })
    await waitFor(() => expect(screen.getByText('操作已取消')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('/project/.codex/skills/Skill One')
  })

  it('keeps symlink visible but disabled when the repository does not support it', async () => {
    const plan = vi.fn().mockResolvedValue(makePlan('plan-copy', '/project/.codex/skills/Skill One'))
    window.xcSkills = {
      operations: { plan, execute: vi.fn(), cancel: vi.fn(), onProgress: vi.fn(() => vi.fn()) },
    } as never
    const store = useOperationStore()
    await store.open({
      kind: 'install', asset, source: { kind: 'central' }, projects, agents,
      location: { projectId: 'proj', agentId: 'codex', path: '/project/.codex/skills/Skill One' },
      allowSymlink: false,
    })

    render(OperationDialog, { global: { plugins: [pinia, ElementPlus] } })

    await waitFor(() => expect(screen.getByRole('radio', { name: '软链接' })).toBeDisabled())
    expect(screen.getByText('当前文件系统不支持创建软链接，请使用复制安装。')).toBeInTheDocument()
    expect(plan).toHaveBeenCalledWith(expect.objectContaining({ method: 'copy' }))
  })

  it('allows managed symlinks for third-party installs and requires explicit source replacement', async () => {
    const user = userEvent.setup()
    const conflict = {
      targetPath: '/project/.codex/skills/Skill One',
      existing: { kind: 'central' as const, repositoryId: null, label: '中央仓库' },
      requested: { kind: 'third-party' as const, repositoryId: 'repo-1', label: 'Team Skills' },
    }
    const inspectSourceConflict = vi.fn().mockResolvedValueOnce(conflict).mockResolvedValueOnce(conflict)
    const plan = vi.fn().mockResolvedValue(makePlan('plan-replace', conflict.targetPath))
    window.xcSkills = {
      operations: { inspectSourceConflict, plan, execute: vi.fn(), cancel: vi.fn(), onProgress: vi.fn(() => vi.fn()) },
    } as never
    const store = useOperationStore()
    await store.open({
      kind: 'install', asset, source: { kind: 'third-party', repositoryId: 'repo-1' }, projects, agents,
      location: { projectId: 'proj', agentId: 'codex', path: conflict.targetPath }, allowSymlink: true,
    })

    render(OperationDialog, { global: { plugins: [pinia, ElementPlus] } })

    expect(await screen.findByRole('radiogroup', { name: '安装方式' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '软链接' })).toBeEnabled()
    expect(screen.getByText('中央仓库')).toBeInTheDocument()
    expect(screen.getByText('Team Skills')).toBeInTheDocument()
    expect(screen.getByText(conflict.targetPath)).toBeInTheDocument()
    expect(plan).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '使用新来源替换' }))
    await waitFor(() => expect(plan).toHaveBeenCalledWith(expect.objectContaining({ replaceExistingSource: true, method: 'copy' })))
  })
})
