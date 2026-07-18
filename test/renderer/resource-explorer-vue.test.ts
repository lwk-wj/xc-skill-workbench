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
      listBranches: vi.fn().mockResolvedValue([
        { name: 'main', current: true, default: true, remote: false },
        { name: 'feature/demo', current: false, default: false, remote: false },
      ]),
      selectBranch: vi.fn().mockResolvedValue({ branch: 'feature/demo', kind: 'branch-cache', allowSymlink: true, stale: false, cachedAt: null }),
      setDefaultBranch: vi.fn(),
    },
    assets: {
      scan: vi.fn().mockImplementation(async (source: { kind: string }) => source.kind === 'central' ? [skill] : duplicates),
      detail: vi.fn().mockImplementation(async ({ assetId }: { assetId: string }) => ({
        ...(assetId.startsWith('codex:') ? duplicates[0] : duplicates[1]), markdown: '# call-api', evolution: null, files: [],
      })),
      statuses: vi.fn().mockResolvedValue([]),
    },
    preferences: {
      getTheme: vi.fn().mockResolvedValue('system'), setTheme: vi.fn(), getLastSource: vi.fn().mockResolvedValue({ kind: 'central' }),
    },
    system: { openExternal: vi.fn().mockResolvedValue(undefined) },
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
    renderTestApp(App)
    const rowLabel = await screen.findByText('Skill One')

    await user.click(rowLabel)
    const drawer = await screen.findByRole('dialog', { name: 'Skill One' })
    expect(drawer).toBeInTheDocument()
    expect(within(drawer).getByText('SK')).toBeInTheDocument()
    expect(within(drawer).getByText('开发 · Skill · v1.0.0')).toBeInTheDocument()
    expect(screen.queryByText('选择资源查看详情')).toBeNull()

    await user.click(within(drawer).getByRole('button', { name: /close/i }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Skill One' })).toBeNull())
    expect(rowLabel.closest('[role="listitem"]')).toHaveClass('selected')
  })
})
