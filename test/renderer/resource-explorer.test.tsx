// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/src/app/App'

const skills = [
  {
    id: 'skill-one', type: 'skills', name: 'Skill One', group: '开发', path: '/tmp/skill-one', entryPath: '/tmp/skill-one/SKILL.md',
    entryState: 'active', description: 'first skill', version: '1.0.0',
  },
  {
    id: 'rule-one', type: 'rules', name: 'Rule One', group: '治理', path: '/tmp/rule-one', entryPath: '/tmp/rule-one/RULE.md',
    entryState: 'frozen', description: 'first rule', version: null,
  },
]

function makeApi() {
  return {
    projects: {
      list: vi.fn().mockResolvedValue([{ id: 'proj', name: 'Demo', path: '/tmp/demo' }]),
      chooseAndAdd: vi.fn().mockResolvedValue({ id: 'new', name: 'New project', path: '/tmp/new' }),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    agents: { list: vi.fn().mockResolvedValue([]), saveCustom: vi.fn(), removeCustom: vi.fn() },
    repositories: {
      getConfig: vi.fn().mockResolvedValue({ mode: 'local', defaultBranch: 'main' }),
      listBranches: vi.fn().mockResolvedValue([
        { name: 'main', current: true, default: true, remote: false },
        { name: 'feature/demo', current: false, default: false, remote: false },
      ]),
      selectBranch: vi.fn().mockResolvedValue({ branch: 'feature/demo', kind: 'branch-cache', allowSymlink: true, stale: false, cachedAt: null }),
      setDefaultBranch: vi.fn(), refresh: vi.fn(),
    },
    assets: { scan: vi.fn().mockResolvedValue(skills), detail: vi.fn(), statuses: vi.fn().mockResolvedValue([]) },
    operations: { plan: vi.fn(), execute: vi.fn(), cancel: vi.fn(), onProgress: vi.fn().mockReturnValue(() => {}) },
    preferences: { getTheme: vi.fn().mockResolvedValue('system'), setTheme: vi.fn(), getLastSource: vi.fn().mockResolvedValue({ kind: 'central' }) },
    system: { openExternal: vi.fn() },
  }
}

describe('resource explorer', () => {
  afterEach(cleanup)
  beforeEach(() => { window.xcSkills = makeApi() as never })

  it('shows the Agent filter only for installed sources', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByText('Skill One')).toBeTruthy())

    expect(screen.queryByRole('combobox', { name: 'Agent筛选' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Demo' }))
    expect(await screen.findByRole('combobox', { name: 'Agent筛选' })).toBeTruthy()
  })

  it('renders filter choices in an anchored application menu', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByText('Skill One')).toBeTruthy())

    const statusFilter = screen.getByRole('combobox', { name: '状态筛选' })
    expect(statusFilter.tagName).toBe('BUTTON')

    await user.click(statusFilter)
    expect(screen.getByRole('listbox', { name: '状态筛选选项' })).toBeTruthy()

    await user.click(screen.getByRole('option', { name: '正常' }))
    expect(screen.queryByRole('listbox', { name: '状态筛选选项' })).toBeNull()

    await user.click(statusFilter)
    await user.click(screen.getByRole('option', { name: '全部状态' }))
  })

  it('closes the branch menu when clicking outside it', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByText('Skill One')).toBeTruthy())

    await user.click(screen.getByRole('button', { name: '选择分支' }))
    expect(screen.getByRole('listbox', { name: '选择分支' })).toBeTruthy()

    await user.click(screen.getByRole('searchbox', { name: '搜索资源' }))
    expect(screen.queryByRole('listbox', { name: '选择分支' })).toBeNull()
  })

  it('loads Central assets, filters/searches, selects branches, and manages projects', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(screen.getByTestId('app-shell')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Skill One')).toBeTruthy())

    await user.click(screen.getByRole('tab', { name: 'Rules' }))
    expect(screen.getByText('Rule One')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: 'Skills' }))
    await user.type(screen.getByRole('searchbox', { name: '搜索资源' }), 'Skill')
    expect(screen.getByText('Skill One')).toBeTruthy()
    expect(screen.queryByText('Rule One')).toBeNull()

    await user.click(screen.getByRole('button', { name: '选择分支' }))
    await user.click(screen.getByRole('option', { name: 'feature/demo' }))
    expect(window.xcSkills.repositories.selectBranch).toHaveBeenCalledWith('feature/demo')

    await user.click(screen.getByRole('button', { name: '添加项目' }))
    expect(await screen.findByText('New project')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '移除项目 Demo' }))
    expect(window.xcSkills.projects.remove).toHaveBeenCalledWith('proj')
  })
})
