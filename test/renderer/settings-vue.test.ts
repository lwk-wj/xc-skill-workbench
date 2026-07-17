// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CustomAgentForm from '../../src/renderer/src/features/settings/CustomAgentForm.vue'
import SettingsDialog from '../../src/renderer/src/features/settings/SettingsDialog.vue'
import ErrorNotice from '../../src/renderer/src/components/ErrorNotice.vue'
import { renderTestApp } from '../../src/renderer/src/app/render-test-app'

const builtIn = {
  id: 'codex', name: 'Codex', projectBaseDir: '/tmp/project/.codex', globalBaseDir: '/tmp/.codex',
  assetDirs: { skills: '/tmp/.codex/skills', rules: '/tmp/.codex/rules', workflows: '/tmp/.codex/workflows' },
  builtIn: true, enabled: true,
}

describe('Vue settings', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })))
  })

  it('validates IDs, relative directories, and keeps built-in IDs read-only', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const view = renderTestApp(CustomAgentForm, { props: { onSave } })
    await user.type(screen.getByLabelText('Agent ID'), '../bad')
    await user.type(screen.getByLabelText('显示名称'), 'Demo')
    await user.type(screen.getByLabelText('项目基础目录'), '/tmp/project')
    await user.type(screen.getByLabelText('全局基础目录'), '/tmp/global')
    await user.clear(screen.getByLabelText('Skills 相对目录'))
    await user.type(screen.getByLabelText('Skills 相对目录'), '/absolute')
    await user.clear(screen.getByLabelText('Rules 相对目录'))
    await user.type(screen.getByLabelText('Rules 相对目录'), '../rules')
    await user.click(screen.getByRole('button', { name: '保存 Agent' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/ID|相对目录/)
    expect(onSave).not.toHaveBeenCalled()

    await view.rerender({ agent: builtIn, onSave })
    expect(screen.getByLabelText('Agent ID')).toHaveAttribute('readonly')
  })

  it('maps structured errors to safe guidance and redacts secrets in paths', () => {
    renderTestApp(ErrorNotice, { props: { error: { code: 'PERMISSION_DENIED', path: '/tmp/private?token=super-secret', message: 'raw secret details' } } })
    expect(screen.getByRole('alert')).toHaveTextContent('在 Finder 中检查权限')
    expect(screen.getByRole('alert')).not.toHaveTextContent('raw secret details')
    expect(screen.getByRole('alert')).not.toHaveTextContent('super-secret')
    expect(screen.getByRole('alert')).toHaveTextContent('token=…')
  })

  it('loads preferences and agents, persists theme, and saves, toggles, and removes custom agents', async () => {
    const user = userEvent.setup()
    const custom = { ...builtIn, id: 'demo', name: 'Demo', builtIn: false, enabled: true }
    const saveCustom = vi.fn()
      .mockResolvedValueOnce([builtIn, custom])
      .mockResolvedValueOnce([builtIn, { ...custom, enabled: false }])
    const removeCustom = vi.fn().mockResolvedValue([builtIn])
    window.xcSkills = {
      preferences: { getTheme: vi.fn().mockResolvedValue('system'), setTheme: vi.fn().mockResolvedValue(undefined), getLastSource: vi.fn() },
      repositories: { getConfig: vi.fn().mockResolvedValue({ mode: 'remote', remoteUrl: 'https://example.com/repo.git', defaultBranch: 'main' }) },
      agents: { list: vi.fn().mockResolvedValue([builtIn]), saveCustom, removeCustom },
    } as never
    renderTestApp(SettingsDialog, { props: { modelValue: true } })

    await waitFor(() => expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('https://example.com/repo.git')).toBeInTheDocument())
    await user.click(screen.getByRole('combobox', { name: '主题' }))
    await user.click(screen.getByText('浅色'))
    await waitFor(() => expect(window.xcSkills.preferences.setTheme).toHaveBeenCalledWith('light'))
    expect(document.documentElement.dataset.theme).toBe('light')

    await user.click(screen.getByRole('button', { name: '添加自定义 Agent' }))
    await user.type(screen.getByLabelText('Agent ID'), 'demo')
    await user.type(screen.getByLabelText('显示名称'), 'Demo')
    await user.type(screen.getByLabelText('项目基础目录'), '/tmp/project/.demo')
    await user.type(screen.getByLabelText('全局基础目录'), '/tmp/.demo')
    await user.click(screen.getByRole('button', { name: '保存 Agent' }))
    await waitFor(() => expect(saveCustom).toHaveBeenCalledWith(expect.objectContaining({
      id: 'demo', assetDirs: { skills: '/tmp/.demo/skills', rules: '/tmp/.demo/rules', workflows: '/tmp/.demo/workflows' },
    })))

    await user.click(screen.getByRole('switch', { name: '启用 Demo' }))
    await waitFor(() => expect(saveCustom).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'demo', enabled: false })))
    await user.click(screen.getByRole('button', { name: '移除 Demo' }))
    expect(removeCustom).toHaveBeenCalledWith('demo')
  })
})
