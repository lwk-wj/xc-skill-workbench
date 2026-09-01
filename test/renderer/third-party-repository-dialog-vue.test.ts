// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import ElementPlus from 'element-plus'
import { cleanup, render, screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ThirdPartyRepositoryDialog from '../../src/renderer/src/features/repositories/ThirdPartyRepositoryDialog.vue'

const repository = {
  id: 'repo-1', name: 'Team Skills', url: 'https://example.com/team.git', branch: 'main', layout: 'catalog' as const,
  skillRoots: [{ relativePath: 'skills/engineering', group: 'engineering' }],
  createdAt: '2026-09-01T00:00:00.000Z', lastFetchedAt: '2026-09-01T01:00:00.000Z', skillCount: 3,
  stale: false, cachedAt: '2026-09-01T01:00:00.000Z', lastError: null,
}

describe('ThirdPartyRepositoryDialog', () => {
  afterEach(cleanup)

  it('lets Main infer an omitted name and branch, then shows the validated repository summary', async () => {
    const user = userEvent.setup()
    const add = vi.fn().mockResolvedValue(repository)
    window.xcSkills = { thirdPartyRepositories: { add } } as never
    render(ThirdPartyRepositoryDialog, { props: { modelValue: true }, global: { plugins: [ElementPlus] } })

    await user.type(await screen.findByRole('textbox', { name: 'Git URL' }), repository.url)
    await user.click(screen.getByRole('button', { name: '验证并添加' }))

    await waitFor(() => expect(add).toHaveBeenCalledWith({ url: repository.url }))
    expect(screen.getByText('标准目录')).toBeInTheDocument()
    expect(screen.getByText('3 个 Skills')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '完成' })).toBeInTheDocument()
  })

  it('keeps the dialog open after validation fails and retries without duplicate submissions', async () => {
    const user = userEvent.setup()
    let reject!: (reason: Error) => void
    const add = vi.fn(() => new Promise((_, rejectPromise) => { reject = rejectPromise }))
    window.xcSkills = { thirdPartyRepositories: { add } } as never
    render(ThirdPartyRepositoryDialog, { props: { modelValue: true }, global: { plugins: [ElementPlus] } })

    await user.type(await screen.findByRole('textbox', { name: 'Git URL' }), repository.url)
    const submit = screen.getByRole('button', { name: '验证并添加' })
    await user.click(submit)
    expect(submit).toBeDisabled()
    await user.click(submit)
    expect(add).toHaveBeenCalledTimes(1)
    reject(new Error('无法访问仓库'))

    expect(await screen.findByText('无法访问仓库')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '添加第三方仓库' })).toBeInTheDocument()
  })

  it('submits multiple configured Skill roots and ignores an untouched empty row', async () => {
    const user = userEvent.setup()
    const add = vi.fn().mockResolvedValue(repository)
    window.xcSkills = { thirdPartyRepositories: { add } } as never
    render(ThirdPartyRepositoryDialog, { props: { modelValue: true }, global: { plugins: [ElementPlus] } })

    await user.type(await screen.findByRole('textbox', { name: 'Git URL' }), repository.url)
    await user.click(screen.getByRole('button', { name: '添加 Skill 目录' }))
    await user.type(screen.getByRole('textbox', { name: 'Skill 相对路径 1' }), 'skills/engineering')
    await user.type(screen.getByRole('textbox', { name: '分组名称 1' }), 'engineering')
    await user.click(screen.getByRole('button', { name: '添加 Skill 目录' }))
    await user.click(screen.getByRole('button', { name: '验证并添加' }))

    await waitFor(() => expect(add).toHaveBeenCalledWith({
      url: repository.url,
      skillRoots: [{ relativePath: 'skills/engineering', group: 'engineering' }],
    }))
  })

  it('updates the existing repository by its stable ID', async () => {
    const user = userEvent.setup()
    const update = vi.fn().mockResolvedValue({ ...repository, branch: 'trunk' })
    window.xcSkills = { thirdPartyRepositories: { update } } as never
    render(ThirdPartyRepositoryDialog, { props: { modelValue: true, repository }, global: { plugins: [ElementPlus] } })

    const branch = await screen.findByRole('textbox', { name: '分支' })
    await user.clear(branch)
    await user.type(branch, 'trunk')
    await user.click(screen.getByRole('button', { name: '验证并保存' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('repo-1', {
      url: repository.url,
      name: repository.name,
      branch: 'trunk',
      skillRoots: repository.skillRoots,
    }))
  })
})
