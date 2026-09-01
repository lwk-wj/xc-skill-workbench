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

    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]!).getByText('Codex')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Claude Code')).toBeInTheDocument()
    await user.click(rows[0]!)
    expect(rows[0]).toHaveClass('selected')
    await waitFor(() => expect(window.xcSkills.assets.detail).toHaveBeenCalled())
    expect(isProxy(vi.mocked(window.xcSkills.assets.detail).mock.calls.at(-1)?.[0].source)).toBe(false)
    await user.click(rows[1]!)
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

  it('opens asset details in a drawer and preserves the selection when closed', async () => {
    const user = userEvent.setup()
    vi.mocked(window.xcSkills.assets.scan).mockResolvedValueOnce([{ ...skill, group: '' }])
    renderTestApp(App)
    const rowLabel = await screen.findByText('Skill One')

    await user.click(rowLabel)
    const drawer = await screen.findByRole('dialog', { name: 'Skill One' })
    expect(drawer).toBeInTheDocument()
    expect(within(drawer).getByText('SK')).toBeInTheDocument()
    expect(within(drawer).getByText('Skill · v1.0.0')).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: '安装到… Skill One' })).toBeNull()
    expect(screen.queryByText('选择资源查看详情')).toBeNull()

    await user.click(within(drawer).getByRole('button', { name: /close/i }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Skill One' })).toBeNull())
    expect(rowLabel.closest('[role="listitem"]')).toHaveClass('selected')
  })

  it('uses the current repository capability when opening an install operation', async () => {
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
    expect(api.repositories.current).toHaveBeenCalledTimes(1)
    expect(within(operation).getByRole('radio', { name: '软链接' })).toBeDisabled()
  })

  it('opens installation directly from a central repository row', async () => {
    const user = userEvent.setup()
    renderTestApp(App)

    await user.click(await screen.findByRole('button', { name: '安装到… Skill One' }))

    expect(screen.queryByRole('dialog', { name: 'Skill One' })).toBeNull()
    expect(await screen.findByRole('dialog', { name: '安装资源' })).toBeInTheDocument()
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
