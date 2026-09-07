// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isProxy } from 'vue'
import App from '../../src/renderer/src/App.vue'
import { renderTestApp } from '../../src/renderer/src/app/render-test-app'

const skill = {
  id: 'skill-one', type: 'skills', name: 'Skill One', group: '开发', path: '/central/skill-one', entryPath: '/central/skill-one/SKILL.md',
  sourceRelativePath: '开发/skills/skill-one',
  entryState: 'active', description: 'first skill', version: '1.0.0',
} as const

const duplicates = [
  { ...skill, id: 'codex:skill-one', name: 'call-api', agentId: 'codex', path: '/project/.codex/skills/call-api', entryPath: '/project/.codex/skills/call-api/SKILL.md' },
  { ...skill, id: 'claude-code:skill-one', name: 'call-api', agentId: 'claude-code', path: '/project/.claude/skills/call-api', entryPath: '/project/.claude/skills/call-api/SKILL.md' },
]

function makeApi() {
  return {
    projects: {
      list: vi.fn().mockResolvedValue([{ id: 'proj', name: 'Demo', path: '/tmp/demo' }]),
      chooseAndAdd: vi.fn().mockResolvedValue(null), remove: vi.fn().mockResolvedValue(undefined),
    },
    agents: {
      list: vi.fn().mockResolvedValue([
        { id: 'codex', name: 'Codex', projectBaseDir: '.codex', globalBaseDir: '/tmp/.codex', assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true },
        { id: 'claude-code', name: 'Claude Code', projectBaseDir: '.claude', globalBaseDir: '/tmp/.claude', assetDirs: { skills: 'skills', rules: 'rules', workflows: 'workflows' }, builtIn: true, enabled: true },
      ]),
      saveCustom: vi.fn(), removeCustom: vi.fn(),
    },
    repositories: {
      getConfig: vi.fn().mockResolvedValue({
        mode: 'remote', repoPath: '', remoteUrl: 'https://example.com/skills.git',
        defaultBranch: 'main', defaultGroups: ['miniapp', 'backend', 'h5', 'common'],
      }),
      current: vi.fn().mockResolvedValue({ branch: 'main', kind: 'branch-cache', allowSymlink: false, stale: false, cachedAt: null }),
      listBranches: vi.fn().mockResolvedValue([
        { name: 'main', current: true, default: true, remote: false },
        { name: 'feature/demo', current: false, default: false, remote: false },
      ]),
      selectBranch: vi.fn().mockResolvedValue({ branch: 'feature/demo', kind: 'branch-cache', allowSymlink: true, stale: false, cachedAt: null }),
      setDefaultBranch: vi.fn(),
      refresh: vi.fn().mockResolvedValue({ branch: 'main', kind: 'branch-cache', allowSymlink: false, stale: false, cachedAt: '2026-09-01T00:00:00.000Z' }),
    },
    thirdPartyRepositories: {
      list: vi.fn().mockResolvedValue([]), add: vi.fn(), update: vi.fn(), remove: vi.fn(), refresh: vi.fn(), relinkInstallation: vi.fn(),
    },
    assets: {
      scan: vi.fn().mockImplementation(async (source: { kind: string }) => source.kind === 'central' ? [skill] : duplicates),
      detail: vi.fn().mockImplementation(async ({ assetId }: { assetId: string }) => ({
        ...(assetId.startsWith('codex:') ? duplicates[0] : duplicates[1]), markdown: '# call-api', evolution: null, files: [],
      })),
      statuses: vi.fn().mockImplementation(async ({ assetId }: { assetId: string }) => assetId.includes(':') ? [{
        projectId: 'proj', agentId: assetId.startsWith('codex:') ? 'codex' : 'claude-code', path: assetId.startsWith('codex:') ? duplicates[0]!.path : duplicates[1]!.path, method: 'copy',
        status: { status: 'current', updateAvailable: false, locallyModified: false, sourceHash: 'a', installedHash: 'a', sourceVersion: '1.0.0', installedVersion: '1.0.0', resolvedTarget: null, reason: '' },
      }] : []),
    },
    preferences: {
      getTheme: vi.fn().mockResolvedValue('system'), setTheme: vi.fn(), getLastSource: vi.fn().mockResolvedValue({ kind: 'central' }),
    },
    system: { openExternal: vi.fn().mockResolvedValue(undefined) },
    operations: {
      inspectSourceConflict: vi.fn().mockResolvedValue(null),
      plan: vi.fn().mockResolvedValue({
        id: 'plan-copy', kind: 'install', asset: { id: skill.id, name: skill.name, type: skill.type, path: skill.path },
        sourceBranch: 'main', sourceHash: 'hash', targetRoot: '/tmp/demo/.codex/skills',
        targetPath: '/tmp/demo/.codex/skills/Skill One', method: 'copy',
        steps: [{ kind: 'copy', source: skill.path, target: '/tmp/demo/.codex/skills/Skill One' }],
        warnings: [], requiresOverwriteConfirmation: false,
      }),
      execute: vi.fn(), cancel: vi.fn(), onProgress: vi.fn(() => vi.fn()),
    },
  }
}

describe('Vue resource explorer', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })))
    window.xcSkills = makeApi() as never
  })

  it('shows platform tags on installed duplicates but not central assets', async () => {
    const user = userEvent.setup()
    renderTestApp(App)
    await waitFor(() => expect(screen.getByText('Skill One')).toBeInTheDocument())

    expect(screen.queryByText('Codex')).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Agent筛选' })).toBeNull()

    await user.click(screen.getByRole('button', { name: /^Demo$/ }))
    await waitFor(() => expect(screen.getAllByText('call-api')).toHaveLength(2))
    expect(screen.getByRole('combobox', { name: 'Agent筛选' })).toBeInTheDocument()

    const rowButtons = screen.getAllByRole('button', { name: '查看 call-api' })
    const rows = rowButtons.map((button) => button.closest('tr')!)
    expect(within(rows[0]!).getByText('Codex')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Claude Code')).toBeInTheDocument()
    await user.click(rowButtons[0]!)
    expect(rows[0]).toHaveClass('selected')
    await waitFor(() => expect(window.xcSkills.assets.detail).toHaveBeenCalled())
    expect(isProxy(vi.mocked(window.xcSkills.assets.detail).mock.calls.at(-1)?.[0].source)).toBe(false)
    await user.click(rowButtons[1]!)
    expect(rows[1]).toHaveClass('selected')
  })

  it('renders the XcSkills brand as a compact logo lockup', async () => {
    renderTestApp(App)
    expect(screen.getByRole('img', { name: 'XcSkills 标志' })).toBeInTheDocument()
    expect(screen.getByText('XcSkills')).toBeInTheDocument()
  })

  it('shows group filtering only for the central repository', async () => {
    const user = userEvent.setup()
    renderTestApp(App)
    await waitFor(() => expect(screen.getByText('Skill One')).toBeInTheDocument())

    expect(screen.getByRole('combobox', { name: '分组筛选' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Demo$/ }))
    await waitFor(() => expect(screen.getAllByText('call-api')).toHaveLength(2))
    expect(screen.queryByRole('combobox', { name: '分组筛选' })).toBeNull()
  })

  it('places global and project sources below the third-party repository section', async () => {
    renderTestApp(App)
    await screen.findByText('Skill One')

    const globalSource = screen.getByRole('button', { name: /^全局安装$/ })
    const thirdPartyHeading = screen.getByRole('heading', { name: '第三方仓库' })
    const projectSource = screen.getByRole('button', { name: /^Demo$/ })
    expect(thirdPartyHeading.compareDocumentPosition(globalSource) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(globalSource.compareDocumentPosition(projectSource) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('pulls the latest central assets from the repository action', async () => {
    const user = userEvent.setup()
    const api = makeApi()
    let repositoryRefreshed = false
    vi.mocked(api.repositories.refresh).mockImplementation(async () => {
      repositoryRefreshed = true
      return { branch: 'main', kind: 'branch-cache', allowSymlink: false, stale: false, cachedAt: '2026-09-01T00:00:00.000Z' }
    })
    vi.mocked(api.assets.scan).mockImplementation(async (source) => source.kind === 'central'
      ? [repositoryRefreshed ? { ...skill, id: 'latest-skill', name: 'Latest Skill' } : skill]
      : duplicates)
    window.xcSkills = api as never
    renderTestApp(App)
    await screen.findByText('Skill One')

    await user.click(screen.getByRole('button', { name: '拉取更新' }))

    expect(await screen.findByText('Latest Skill')).toBeInTheDocument()
    expect(screen.queryByText('Skill One')).toBeNull()
  })

  it('disables the repository action while a pull is running', async () => {
    const user = userEvent.setup()
    const api = makeApi()
    let finishRefresh!: (view: Awaited<ReturnType<typeof api.repositories.refresh>>) => void
    vi.mocked(api.repositories.refresh).mockImplementation(() => new Promise((resolve) => { finishRefresh = resolve }))
    window.xcSkills = api as never
    renderTestApp(App)
    await screen.findByText('Skill One')

    await user.click(screen.getByRole('button', { name: '拉取更新' }))

    expect(await screen.findByRole('button', { name: '正在拉取' })).toBeDisabled()
    finishRefresh({ branch: 'main', kind: 'branch-cache', allowSymlink: false, stale: false, cachedAt: '2026-09-01T00:00:00.000Z' })
    await waitFor(() => expect(screen.getByRole('button', { name: '拉取更新' })).toBeEnabled())
  })

  it('shows a local rescan action for global and project sources only', async () => {
    const user = userEvent.setup()
    renderTestApp(App)
    await screen.findByText('Skill One')

    expect(screen.queryByRole('button', { name: '重新扫描' })).toBeNull()
    await user.click(screen.getByRole('button', { name: /^全局安装$/ }))
    expect(await screen.findByRole('button', { name: '重新扫描' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /添加项目/ }))
    await user.click(screen.getByRole('button', { name: /^Demo$/ }))
    expect(await screen.findByRole('button', { name: '重新扫描' })).toBeInTheDocument()
  })

  it('opens repository resource installation from the current project page', async () => {
    const user = userEvent.setup()
    const api = makeApi()
    window.xcSkills = api as never
    renderTestApp(App)
    await screen.findByText('Skill One')

    await user.click(screen.getByRole('button', { name: /^Demo$/ }))
    await waitFor(() => expect(screen.getAllByText('call-api')).toHaveLength(2))
    await user.click(await screen.findByRole('button', { name: '安装新资源' }))

    const installDialog = await screen.findByRole('dialog', { name: '安装新资源到项目' })
    expect(within(installDialog).getByText('安装目标')).toBeInTheDocument()
    expect(within(installDialog).getByText('Demo')).toBeInTheDocument()
    const row = (await within(installDialog).findByText('Skill One')).closest('tr')!
    await user.click(within(row).getByRole('checkbox', { name: /Select this row|选择此行/ }))
    await user.click(within(installDialog).getByRole('button', { name: '安装到当前项目' }))

    const batchDialog = await screen.findByRole('dialog', { name: '批量安装资源' })
    expect(within(batchDialog).getByText('目标已锁定')).toBeInTheDocument()
    expect(within(batchDialog).getByText('Demo')).toBeInTheDocument()
    await waitFor(() => expect(api.operations.plan).toHaveBeenLastCalledWith(expect.objectContaining({
      target: { scope: 'project', projectId: 'proj', agentId: 'codex' },
      method: 'symlink',
    })))
  })

  it('opens repository resource installation from the global page', async () => {
    const user = userEvent.setup()
    const api = makeApi()
    window.xcSkills = api as never
    renderTestApp(App)
    await screen.findByText('Skill One')

    await user.click(screen.getByRole('button', { name: /^全局安装$/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: '安装新资源' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '安装新资源' }))

    const installDialog = await screen.findByRole('dialog', { name: '安装新资源到全局' })
    expect(within(installDialog).getByText('安装目标')).toBeInTheDocument()
    expect(within(installDialog).getByText('全局')).toBeInTheDocument()
    const row = (await within(installDialog).findByText('Skill One')).closest('tr')!
    await user.click(within(row).getByRole('checkbox', { name: /Select this row|选择此行/ }))
    await user.click(within(installDialog).getByRole('button', { name: '安装到全局' }))

    const batchDialog = await screen.findByRole('dialog', { name: '批量安装资源' })
    expect(within(batchDialog).getByText('目标已锁定')).toBeInTheDocument()
    expect(within(batchDialog).getByText('全局')).toBeInTheDocument()
    await waitFor(() => expect(api.operations.plan).toHaveBeenLastCalledWith(expect.objectContaining({
      target: { scope: 'global', agentId: 'codex' },
      method: 'symlink',
    })))
  })

  it('rescans only the selected local source without pulling a repository', async () => {
    const user = userEvent.setup()
    const api = makeApi()
    window.xcSkills = api as never
    renderTestApp(App)
    await screen.findByText('Skill One')
    await user.click(screen.getByRole('button', { name: /^全局安装$/ }))
    await waitFor(() => expect(api.assets.scan).toHaveBeenCalledWith({ kind: 'global' }))
    api.assets.scan.mockClear()
    api.repositories.refresh.mockClear()

    await user.click(screen.getByRole('button', { name: '重新扫描' }))

    await waitFor(() => expect(api.assets.scan).toHaveBeenCalledWith({ kind: 'global' }))
    expect(api.repositories.refresh).not.toHaveBeenCalled()
  })

  it('clears the selected asset before changing sources', async () => {
    const user = userEvent.setup()
    renderTestApp(App)
    await user.click(await screen.findByText('Skill One'))
    await waitFor(() => expect(window.xcSkills.assets.detail).toHaveBeenCalled())
    vi.mocked(window.xcSkills.assets.detail).mockClear()

    await user.click(screen.getByRole('button', { name: /^Demo$/ }))
    await waitFor(() => expect(screen.getAllByText('call-api')).toHaveLength(2))

    expect(window.xcSkills.assets.detail).not.toHaveBeenCalled()
  })

  it('clears batch selection when the resource context changes', async () => {
    const user = userEvent.setup()
    renderTestApp(App)
    const skillRow = (await screen.findByRole('button', { name: '查看 Skill One' })).closest('tr')!
    await user.click(within(skillRow).getByRole('checkbox', { name: /Select this row|选择此行/ }))
    await waitFor(() => expect(screen.getByText('已选择 1 项')).toBeInTheDocument())

    await user.type(screen.getByRole('textbox', { name: '搜索资源' }), 'Skill')
    expect(screen.getByText('已选择 0 项')).toBeInTheDocument()
    await user.clear(screen.getByRole('textbox', { name: '搜索资源' }))
    const restoredRow = (await screen.findByRole('button', { name: '查看 Skill One' })).closest('tr')!
    await user.click(within(restoredRow).getByRole('checkbox', { name: /Select this row|选择此行/ }))

    await user.click(screen.getByRole('button', { name: /^Demo$/ }))
    await waitFor(() => expect(screen.getAllByText('call-api')).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: /^中央仓库$/ }))
    await screen.findByText('Skill One')

    expect(screen.getByText('已选择 0 项')).toBeInTheDocument()
    const currentRow = (await screen.findByRole('button', { name: '查看 Skill One' })).closest('tr')!
    expect(within(currentRow).getByRole('checkbox', { name: /Select this row|选择此行/ })).not.toBeChecked()
  })

  it('opens asset details in a drawer and preserves the selection when closed', async () => {
    const user = userEvent.setup()
    vi.mocked(window.xcSkills.assets.scan).mockResolvedValueOnce([{ ...skill, group: '' }])
    renderTestApp(App)
    const rowLabel = await screen.findByRole('button', { name: '查看 Skill One' })

    await user.click(rowLabel)
    const drawer = await screen.findByRole('dialog', { name: 'Skill One' })
    expect(drawer).toBeInTheDocument()
    expect(within(drawer).getByText('SK')).toBeInTheDocument()
    expect(within(drawer).getByText('Skill · v1.0.0')).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: '安装到… Skill One' })).toBeNull()
    expect(screen.queryByText('选择资源查看详情')).toBeNull()

    await user.click(within(drawer).getByRole('button', { name: /close/i }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Skill One' })).toBeNull())
    expect(rowLabel.closest('tr')).toHaveClass('selected')
  })

  it('allows a local entity-store symlink even when the repository itself is cached', async () => {
    const user = userEvent.setup()
    const api = makeApi()
    vi.mocked(api.assets.statuses).mockResolvedValue([{
      projectId: 'proj', agentId: 'codex', path: '/tmp/demo/.codex/skills/Skill One', method: null,
      status: {
        status: 'not_installed', updateAvailable: false, locallyModified: false,
        sourceHash: 'hash', installedHash: null, sourceVersion: '1.0.0', installedVersion: null,
        resolvedTarget: null, reason: '',
      },
    }])
    window.xcSkills = api as never
    renderTestApp(App)

    await user.click(await screen.findByRole('button', { name: '安装到… Skill One' }))

    const operation = await screen.findByRole('dialog', { name: '安装资源' })
    expect(api.repositories.current).not.toHaveBeenCalled()
    expect(within(operation).getByRole('radio', { name: '软链接' })).toBeEnabled()
  })

  it('opens installation directly from a central repository row', async () => {
    const user = userEvent.setup()
    renderTestApp(App)

    await user.click(await screen.findByRole('button', { name: '安装到… Skill One' }))

    expect(screen.queryByRole('dialog', { name: 'Skill One' })).toBeNull()
    expect(await screen.findByRole('dialog', { name: '安装资源' })).toBeInTheDocument()
  })

  it('opens one shared batch install dialog for multiple selected repository resources', async () => {
    const user = userEvent.setup()
    const api = makeApi()
    const second = { ...skill, id: 'skill-two', name: 'Skill Two', path: '/central/skill-two', entryPath: '/central/skill-two/SKILL.md' }
    vi.mocked(api.assets.scan).mockImplementation(async (source) => source.kind === 'central' ? [skill, second] : duplicates)
    window.xcSkills = api as never
    renderTestApp(App)

    const firstRow = (await screen.findByRole('button', { name: '查看 Skill One' })).closest('tr')!
    const secondRow = (await screen.findByRole('button', { name: '查看 Skill Two' })).closest('tr')!
    await user.click(within(firstRow).getByRole('checkbox', { name: /Select this row|选择此行/ }))
    await user.click(within(secondRow).getByRole('checkbox', { name: /Select this row|选择此行/ }))
    await user.click(screen.getByRole('button', { name: '批量安装' }))

    expect(screen.queryByRole('dialog', { name: 'Skill One' })).toBeNull()
    const dialog = await screen.findByRole('dialog', { name: '批量安装资源' })
    expect(within(dialog).getByText('2 个资源 · 1 个 Agent · 2 项操作')).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: '目标范围' })).toBeInTheDocument()
  })

  it('renders third-party navigation and uses layout-aware repository filters', async () => {
    const user = userEvent.setup()
    const api = makeApi()
    const repository = {
      id: 'repo-1', name: 'Team Skills', url: 'https://example.com/team.git', branch: 'trunk', layout: 'catalog' as const,
      createdAt: '2026-09-01T00:00:00.000Z', lastFetchedAt: '2026-09-01T01:00:00.000Z', skillCount: 1,
      stale: false, cachedAt: '2026-09-01T01:00:00.000Z', lastError: null,
    }
    vi.mocked(api.thirdPartyRepositories.list).mockResolvedValue([repository])
    vi.mocked(api.assets.scan).mockImplementation(async (source) => source.kind === 'third-party' ? [{ ...skill, group: 'common' }] : [skill])
    window.xcSkills = api as never
    renderTestApp(App)

    expect(await screen.findByRole('heading', { name: '第三方仓库' })).toBeVisible()
    await user.click(await screen.findByRole('button', { name: /^Team Skills$/ }))
    await waitFor(() => expect(api.assets.scan).toHaveBeenLastCalledWith({ kind: 'third-party', repositoryId: 'repo-1' }))
    expect(screen.getByRole('combobox', { name: '分组筛选' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Agent筛选' })).toBeNull()
    expect(screen.getByText('trunk')).toBeInTheDocument()
  })
})
