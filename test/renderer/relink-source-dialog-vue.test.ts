// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import ElementPlus from 'element-plus'
import { cleanup, render, screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RelinkSourceDialog from '../../src/renderer/src/features/repositories/RelinkSourceDialog.vue'

const asset = {
  id: 'codex:skill-one', type: 'skills' as const, name: 'Skill One', group: 'backend', agentId: 'codex',
  sourceRelativePath: 'backend/skills/skill-one',
  path: '/project/.codex/skills/skill-one', entryPath: '/project/.codex/skills/skill-one/SKILL.md',
  entryState: 'active' as const, description: 'fixture', version: '1.0.0',
}
const location = {
  projectId: 'proj', agentId: 'codex', path: asset.path, method: 'copy' as const, installationId: 'install-1',
  status: { status: 'source_unavailable' as const, updateAvailable: false, locallyModified: false, sourceHash: null, installedHash: 'a', sourceVersion: null, installedVersion: '1.0.0', resolvedTarget: null, reason: '来源仓库不可用' },
}
const repository = {
  id: 'repo-1', name: 'Team Skills', url: 'https://example.com/team.git', branch: 'main', layout: 'catalog' as const,
  createdAt: '2026-09-01T00:00:00.000Z', lastFetchedAt: '2026-09-01T01:00:00.000Z', skillCount: 1,
  stale: false, cachedAt: '2026-09-01T01:00:00.000Z', lastError: null,
}

describe('RelinkSourceDialog', () => {
  afterEach(cleanup)

  it('offers exact name matches and relinks the existing installation record', async () => {
    const user = userEvent.setup()
    const relinkInstallation = vi.fn().mockResolvedValue(undefined)
    window.xcSkills = {
      thirdPartyRepositories: { list: vi.fn().mockResolvedValue([repository]), relinkInstallation },
      assets: { scan: vi.fn().mockResolvedValue([{ ...asset, id: 'skill-one', agentId: undefined, path: '/cache/skill-one', entryPath: '/cache/skill-one/SKILL.md' }]) },
    } as never
    render(RelinkSourceDialog, { props: { modelValue: true, asset, location }, global: { plugins: [ElementPlus] } })

    expect(await screen.findByRole('combobox', { name: '新的来源' })).toBeInTheDocument()
    expect(screen.getAllByText('Team Skills · main').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: '确认关联' }))

    await waitFor(() => expect(relinkInstallation).toHaveBeenCalledWith({
      installationId: 'install-1', repositoryId: 'repo-1', assetId: 'skill-one',
    }))
  })

  it('repairs a managed resource with an unresolved repository path', async () => {
    const user = userEvent.setup()
    const executeManagedEntityRepair = vi.fn().mockResolvedValue({
      installationId: 'install-1', entityId: 'entity-new', fromRelativePath: 'xcSkill/skills/backend/skill-one',
      toRelativePath: 'xcSkill/backend/skills/skill-one', rebuiltSymlinkCount: 1,
    })
    window.xcSkills = {
      repositories: {
        previewManagedEntityRepair: vi.fn().mockResolvedValue({
          installationId: 'install-1', entityId: 'entity-old', candidates: [{
            candidateToken: 'candidate-token', repositoryLabel: '中央仓库', sourceRelativePath: 'backend/skills/skill-one',
          }], expiresAt: '2026-09-01T10:00:00.000Z',
        }),
        executeManagedEntityRepair,
      },
      thirdPartyRepositories: { list: vi.fn(), relinkInstallation: vi.fn() },
    } as never
    render(RelinkSourceDialog, { props: { modelValue: true, asset, location: {
      ...location, status: { ...location.status, reason: '受管资源缺少仓库相对路径，请确认来源' },
    } }, global: { plugins: [ElementPlus] } })

    expect(await screen.findByRole('combobox', { name: '新的来源' })).toBeInTheDocument()
    expect(screen.getAllByText('中央仓库 · backend/skills/skill-one').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: '确认关联' }))

    await waitFor(() => expect(executeManagedEntityRepair).toHaveBeenCalledWith('candidate-token'))
    expect(window.xcSkills.thirdPartyRepositories.list).not.toHaveBeenCalled()
  })
})
