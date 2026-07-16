// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AssetDetail } from '../../src/renderer/src/components/AssetDetail'
import type { AssetDetail as AssetDetailRecord } from '../../src/shared/ipc.js'

const asset = {
  id: 'skill-one', type: 'skills', name: 'Skill One', group: '开发', path: '/tmp/skill-one', entryPath: '/tmp/skill-one/SKILL.md',
  entryState: 'active', description: 'first skill', version: '1.0.0',
} as const

const detail: AssetDetailRecord = {
  ...asset, markdown: '# Skill One\n\n[Docs](https://example.com)', evolution: '# Evolution\n\n## 1.0.0',
  files: [{ relativePath: 'SKILL.md', size: 24, kind: 'text' }, { relativePath: 'image.bin', size: 1024, kind: 'binary' }],
}

const statuses = [
  { projectId: null, agentId: 'codex', path: '/global/skills/Skill One', method: 'symlink' as const, status: { status: 'current' as const, updateAvailable: false, locallyModified: false, sourceHash: 'a', installedHash: 'a', sourceVersion: '1.0.0', installedVersion: '1.0.0', resolvedTarget: '/central/Skill One', reason: '' } },
  { projectId: 'proj', agentId: 'claude', path: '/project/skills/Skill One', method: 'copy' as const, status: { status: 'locally_modified' as const, updateAvailable: true, locallyModified: true, sourceHash: 'a', installedHash: 'b', sourceVersion: '1.0.0', installedVersion: '1.0.0', resolvedTarget: null, reason: '' } },
]

describe('asset detail', () => {
  beforeEach(() => {
    cleanup()
    window.xcSkills = { system: { openExternal: vi.fn() } } as never
  })

  it('switches preview, source, files, and evolution tabs and shows statuses', async () => {
    const user = userEvent.setup()
    render(<AssetDetail asset={asset} loadDetail={vi.fn().mockResolvedValue(detail)} loadStatuses={vi.fn().mockResolvedValue(statuses)} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Skill One' })).toBeTruthy())
    expect(screen.getByRole('tab', { name: '预览' })).toBeTruthy()
    expect(screen.getByTestId('markdown-preview').textContent).toContain('Skill One')
    expect(screen.getByText('Global')).toBeTruthy()
    expect(screen.getByText('codex')).toBeTruthy()
    expect(screen.getByText('/global/skills/Skill One')).toBeTruthy()
    expect(screen.getByText('最新')).toBeTruthy()
    expect(screen.getByText('symlink')).toBeTruthy()

    await user.click(screen.getByRole('tab', { name: '源码' }))
    expect(screen.getByRole('tabpanel').textContent).toContain('# Skill One')
    await user.click(screen.getByRole('tab', { name: '文件' }))
    expect(screen.getByText('SKILL.md')).toBeTruthy()
    expect(screen.getByText('image.bin')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: '演进历史' }))
    expect(screen.getByTestId('evolution-content').textContent).toContain('Evolution')
  })

  it('omits evolution and freeze controls for Rules', async () => {
    const rule = { ...asset, id: 'rule-one', type: 'rules' as const, name: 'Rule One', entryPath: '/tmp/rule-one/RULE.md' }
    render(<AssetDetail asset={rule} loadDetail={vi.fn().mockResolvedValue({ ...detail, ...rule, evolution: '# no' })} loadStatuses={vi.fn().mockResolvedValue([])} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Rule One' })).toBeTruthy())
    expect(screen.queryByRole('tab', { name: '演进历史' })).toBeNull()
    expect(screen.queryByRole('button', { name: '冻结' })).toBeNull()
  })

  it('shows binary and oversized files as metadata-only', async () => {
    render(<AssetDetail asset={asset} loadDetail={vi.fn().mockResolvedValue({ ...detail, markdown: null, files: [{ relativePath: 'archive.bin', size: 2_000_000, kind: 'binary' }] })} loadStatuses={vi.fn().mockResolvedValue([])} />)
    await waitFor(() => expect(screen.getByText(/仅显示文件元数据/)).toBeTruthy())
    expect(screen.queryByTestId('markdown-preview')).toBeNull()
  })
})
