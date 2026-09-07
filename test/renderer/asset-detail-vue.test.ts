// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AssetDetail from '../../src/renderer/src/components/AssetDetail.vue'
import { renderTestApp } from '../../src/renderer/src/app/render-test-app'
import type { AssetDetail as AssetDetailRecord, AssetRecord } from '../../src/shared/ipc.js'

const asset: AssetRecord = {
  id: 'codex:skill-one', type: 'skills', name: 'Skill One', group: '开发', path: '/tmp/skill-one', entryPath: '/tmp/skill-one/SKILL.md',
  sourceRelativePath: '开发/skills/skill-one',
  entryState: 'active', description: 'first skill', version: '1.0.0', agentId: 'codex',
}

const detail: AssetDetailRecord = {
  ...asset, markdown: '# Skill One\n\n[Docs](https://example.com)\n\n[Bad](javascript:alert(1))', evolution: '# Evolution\n\n## 1.0.0',
  files: [{ relativePath: 'SKILL.md', size: 24, kind: 'text' }, { relativePath: 'image.bin', size: 1024, kind: 'binary' }],
}

const statuses = [
  { projectId: null, agentId: 'codex', path: '/global/skills/Skill One', method: 'symlink' as const, status: { status: 'current' as const, updateAvailable: false, locallyModified: false, sourceHash: 'a', installedHash: 'a', sourceVersion: '1.0.0', installedVersion: '1.0.0', resolvedTarget: '/central/Skill One', reason: '' } },
  { projectId: 'proj', agentId: 'claude-code', path: '/project/skills/Skill One', method: 'copy' as const, status: { status: 'locally_modified' as const, updateAvailable: true, locallyModified: true, sourceHash: 'a', installedHash: 'b', sourceVersion: '1.0.0', installedVersion: '1.0.0', resolvedTarget: null, reason: '' } },
]

const projects = [{ id: 'proj', name: 'Demo Project', path: '/tmp/demo' }]
const agents = [
  { id: 'codex', name: 'Codex', projectBaseDir: '/tmp/.codex', globalBaseDir: '/tmp/.codex', assetDirs: { skills: '/skills', rules: '/rules', workflows: '/workflows' }, builtIn: true, enabled: true },
  { id: 'claude-code', name: 'Claude Code', projectBaseDir: '/tmp/.claude', globalBaseDir: '/tmp/.claude', assetDirs: { skills: '/skills', rules: '/rules', workflows: '/workflows' }, builtIn: true, enabled: true },
]

describe('Vue asset detail', () => {
  afterEach(cleanup)
  beforeEach(() => {
    window.xcSkills = { system: { openExternal: vi.fn().mockResolvedValue(undefined) } } as never
  })

  it('loads a qualified selection and switches preview, source, files, and evolution tabs', async () => {
    const user = userEvent.setup()
    const loadDetail = vi.fn().mockResolvedValue(detail)
    const loadStatuses = vi.fn().mockResolvedValue(statuses)
    renderTestApp(AssetDetail, { props: { asset, source: { kind: 'project', projectId: 'proj' }, loadDetail, loadStatuses, projects, agents } })

    await waitFor(() => expect(screen.getByTestId('markdown-preview')).toHaveTextContent('Skill One'))
    expect(loadDetail).toHaveBeenCalledWith({ source: { kind: 'project', projectId: 'proj' }, assetId: 'codex:skill-one' })
    expect(loadStatuses).toHaveBeenCalledWith({ source: { kind: 'project', projectId: 'proj' }, assetId: 'codex:skill-one' })
    expect(screen.getByText('Global · 全局')).not.toBeVisible()

    const docs = screen.getByRole('link', { name: 'Docs' })
    await user.click(docs)
    expect(window.xcSkills.system.openExternal).toHaveBeenCalledWith('https://example.com')
    expect(screen.getByText('Bad').closest('a')).not.toHaveAttribute('href')

    await user.click(screen.getByRole('tab', { name: '源码' }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent('# Skill One')
    await user.click(screen.getByRole('tab', { name: '文件' }))
    const filesPanel = screen.getByRole('tabpanel', { name: '文件' })
    expect(within(filesPanel).getByText('SKILL.md')).toBeInTheDocument()
    expect(within(filesPanel).getByText('image.bin')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '演进历史' }))
    expect(screen.getByTestId('evolution-content')).toHaveTextContent('Evolution')
    await user.click(screen.getByRole('tab', { name: /安装状态/ }))
    expect(screen.getByText('Global · 全局')).toBeInTheDocument()
    expect(screen.getByText('Demo Project · 项目')).toBeInTheDocument()
  })

  it('keeps installation status read-only for Skills and Rules', async () => {
    const user = userEvent.setup()
    const view = renderTestApp(AssetDetail, { props: { asset, source: { kind: 'central' }, loadDetail: vi.fn().mockResolvedValue(detail), loadStatuses: vi.fn().mockResolvedValue(statuses) } })
    await user.click(await screen.findByRole('tab', { name: /安装状态/ }))
    expect(screen.queryByRole('button', { name: /更新|冻结|解冻|卸载|安装到/ })).toBeNull()

    const rule = { ...asset, id: 'codex:rule-one', type: 'rules' as const, name: 'Rule One', entryPath: '/tmp/rule-one/RULE.md' }
    await view.rerender({ asset: rule, source: { kind: 'central' }, loadDetail: vi.fn().mockResolvedValue({ ...detail, ...rule, evolution: '# hidden' }), loadStatuses: vi.fn().mockResolvedValue([{ ...statuses[0] }]) })
    await waitFor(() => expect(screen.getByRole('tab', { name: /安装状态/ })).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Rule One' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '演进历史' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: /安装状态/ }))
    expect(screen.queryByRole('button', { name: '冻结 Rule One' })).toBeNull()
  })

  it('shows metadata-only messages for binary or oversized content', async () => {
    renderTestApp(AssetDetail, { props: { asset, source: { kind: 'central' }, loadDetail: vi.fn().mockResolvedValue({ ...detail, markdown: null, files: [{ relativePath: 'archive.bin', size: 2_000_000, kind: 'binary' }] }), loadStatuses: vi.fn().mockResolvedValue([]) } })
    await waitFor(() => expect(screen.getByText(/仅显示文件元数据/)).toBeInTheDocument())
    expect(screen.queryByTestId('markdown-preview')).toBeNull()
  })

  it('ignores a stale request after the selected asset changes', async () => {
    let resolveFirst!: (value: AssetDetailRecord) => void
    const first = new Promise<AssetDetailRecord>((resolve) => { resolveFirst = resolve })
    const loadDetail = vi.fn().mockImplementationOnce(() => first).mockResolvedValueOnce({ ...detail, id: 'codex:skill-two', name: 'Skill Two', markdown: '# Skill Two' })
    const loadStatuses = vi.fn().mockResolvedValue([])
    const view = renderTestApp(AssetDetail, { props: { asset, source: { kind: 'central' }, loadDetail, loadStatuses } })
    const secondAsset = { ...asset, id: 'codex:skill-two', name: 'Skill Two' }
    await view.rerender({ asset: secondAsset, source: { kind: 'central' }, loadDetail, loadStatuses })
    await waitFor(() => expect(screen.getByTestId('markdown-preview')).toHaveTextContent('Skill Two'))
    resolveFirst(detail)
    await fireEvent.click(document.body)
    expect(screen.getByTestId('markdown-preview')).toHaveTextContent('Skill Two')
    expect(screen.getByTestId('markdown-preview')).not.toHaveTextContent('Skill One')
  })
})
