// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OperationDialog } from '../../src/renderer/src/features/operations/OperationDialog'

const asset = { id: 'skill-one', type: 'skills' as const, name: 'Skill One', group: '开发', path: '/central/Skill One', entryPath: '/central/Skill One/SKILL.md', entryState: 'active' as const, description: '', version: '1.0.0' }
const agents = [{ id: 'codex', name: 'Codex', projectBaseDir: '/project', globalBaseDir: '/global', assetDirs: { skills: '/skills', rules: '/rules', workflows: '/workflows' }, builtIn: true, enabled: true }]

describe('operation dialog', () => {
  afterEach(cleanup)
  it('previews exact paths, warns before destructive confirmation, and executes with progress', async () => {
    const user = userEvent.setup()
    const plan = { id: 'plan-1', kind: 'install' as const, asset: { id: asset.id, name: asset.name, type: asset.type, path: asset.path }, sourceBranch: 'main', sourceHash: 'hash', targetRoot: '/global/skills', targetPath: '/global/skills/Skill One', method: 'symlink' as const, steps: [{ kind: 'symlink' as const, source: asset.path, target: '/global/skills/Skill One' }], warnings: ['本地有修改'], requiresOverwriteConfirmation: true }
    const onExecute = vi.fn().mockResolvedValue({ planId: plan.id, status: 'completed', affectedPaths: [plan.targetPath], residualPaths: [] })
    render(<OperationDialog open kind="install" asset={asset} projects={[]} agents={agents} onClose={vi.fn()} plan={vi.fn().mockResolvedValue(plan)} execute={onExecute} cancel={vi.fn()} />)
    expect(screen.getByText('/global/skills/Skill One')).toBeInTheDocument()
    expect(screen.getByText('本地有修改')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /确认|执行/ }))
    expect(onExecute).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /确认执行/ }))
    expect(onExecute).toHaveBeenCalledWith(plan.id)
  })
})
