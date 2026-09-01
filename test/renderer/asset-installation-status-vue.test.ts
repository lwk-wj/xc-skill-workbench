// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import AssetInstallationStatus from '../../src/renderer/src/components/AssetInstallationStatus.vue'
import { renderTestApp } from '../../src/renderer/src/app/render-test-app'
import type { AgentDefinition, AssetRecord, ProjectRecord } from '../../src/shared/ipc.js'

const asset: AssetRecord = {
  id: 'skill-one', type: 'skills', name: 'Skill One', group: 'backend',
  path: '/central/skill-one', entryPath: '/central/skill-one/SKILL.md',
  entryState: 'active', description: 'fixture', version: '1.0.0',
}

const projects: ProjectRecord[] = [{ id: 'proj', name: 'Demo Project', path: '/tmp/demo' }]
const agents: AgentDefinition[] = [
  { id: 'codex', name: 'Codex', projectBaseDir: '/tmp/project/.codex', globalBaseDir: '/tmp/global/.codex', assetDirs: { skills: '/skills', rules: '/rules', workflows: '/workflows' }, builtIn: true, enabled: true },
  { id: 'claude-code', name: 'Claude Code', projectBaseDir: '/tmp/project/.claude', globalBaseDir: '/tmp/global/.claude', assetDirs: { skills: '/skills', rules: '/rules', workflows: '/workflows' }, builtIn: true, enabled: true },
]

const statuses = [
  { projectId: null, agentId: 'codex', path: '/global/skills/skill-one', method: 'symlink' as const, status: { status: 'current' as const, updateAvailable: false, locallyModified: false, sourceHash: 'a', installedHash: 'a', sourceVersion: '1.0.0', installedVersion: '1.0.0', resolvedTarget: '/central/skill-one', reason: '' } },
  { projectId: 'proj', agentId: 'claude-code', path: '/project/skills/skill-one', method: 'copy' as const, status: { status: 'locally_modified' as const, updateAvailable: true, locallyModified: true, sourceHash: 'a', installedHash: 'b', sourceVersion: '1.0.0', installedVersion: '1.0.0', resolvedTarget: null, reason: '' } },
]

describe('AssetInstallationStatus', () => {
  afterEach(cleanup)

  it('groups named locations, filters by scope, and stays read-only', async () => {
    const user = userEvent.setup()
    renderTestApp(AssetInstallationStatus, { props: { asset, statuses, projects, agents } })

    expect(screen.getByText('Global · 全局')).toBeInTheDocument()
    expect(screen.getByText('Demo Project · 项目')).toBeInTheDocument()
    expect(screen.getByText('Codex')).toBeInTheDocument()
    expect(screen.getByText('Claude Code')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: '项目' }))
    expect(screen.queryByText('Global · 全局')).toBeNull()
    expect(screen.getByText('Demo Project · 项目')).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: /更新|冻结|解冻|卸载|安装到/ })).toBeNull()
  })

  it('labels an asset without a central counterpart as a non-repository resource', () => {
    renderTestApp(AssetInstallationStatus, {
      props: {
        asset,
        statuses: [{
          ...statuses[1]!,
          status: {
            ...statuses[1]!.status,
            status: 'unknown',
            updateAvailable: false,
            locallyModified: false,
            reason: '中央分支不存在同名资产',
          },
        }],
        projects,
        agents,
      },
    })

    expect(screen.getByText('非仓库资源')).toBeInTheDocument()
    expect(screen.queryByText('未知')).toBeNull()
  })

  it('offers relinking when an installation source was removed', async () => {
    const user = userEvent.setup()
    const sourceUnavailable = {
      ...statuses[1]!,
      installationId: 'install-1',
      status: { ...statuses[1]!.status, status: 'source_unavailable' as const, reason: '来源仓库不可用' },
    }
    const view = renderTestApp(AssetInstallationStatus, { props: { asset, statuses: [sourceUnavailable], projects, agents } })

    await user.click(screen.getByRole('button', { name: '重新关联来源' }))
    expect(view.emitted()['relink-source']?.[0]).toEqual([sourceUnavailable])
  })
})
