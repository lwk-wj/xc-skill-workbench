// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AssetList from '../../src/renderer/src/components/AssetList.vue'
import { renderTestApp } from '../../src/renderer/src/app/render-test-app'
import type { AssetRecord } from '../../src/shared/ipc.js'

const active: AssetRecord = {
  id: 'codex:skill-one', type: 'skills', name: 'Skill One', group: 'backend', agentId: 'codex',
  sourceRelativePath: 'backend/skills/skill-one',
  path: '/project/.codex/skills/skill-one', entryPath: '/project/.codex/skills/skill-one/SKILL.md',
  entryState: 'active', description: 'fixture', version: '1.0.0',
}

const location = {
  projectId: 'proj', agentId: 'codex', path: active.path, method: 'copy' as const,
  status: { status: 'current' as const, updateAvailable: false, locallyModified: false, sourceHash: 'a', installedHash: 'a', sourceVersion: '1.0.0', installedVersion: '1.0.0', resolvedTarget: null, reason: '' },
}
const outdatedLocation = {
  ...location,
  status: { ...location.status, status: 'update_available' as const, updateAvailable: true },
}

const baseProps = {
  selectedId: null, selectedIds: [] as string[], agentName: () => 'Codex', loading: false, error: null, query: '', groupFilter: 'all', statusFilter: 'all', agentFilter: 'all',
}

describe('AssetList operations', () => {
  afterEach(cleanup)

  it('puts the contextual primary operation on project rows without selecting the row', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onAction = vi.fn()
    renderTestApp(AssetList, { props: { ...baseProps, assets: [active], sourceKind: 'project', managementStatuses: { [active.id]: [location] } }, attrs: { onSelect, onAction } })

    await user.click(await screen.findByRole('button', { name: '冻结 Skill One' }))
    expect(onAction).toHaveBeenCalledWith('freeze', active, location)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '更多操作 Skill One' })).toBeInTheDocument()
  })

  it('labels managed installation methods and gives symlinks only an uninstall action', async () => {
    const symlink = { ...active, id: 'codex:linked', name: 'Linked Skill' }
    const copied = { ...active, id: 'codex:copied', name: 'Copied Skill' }
    const untracked = { ...active, id: 'codex:untracked', name: 'Untracked Skill' }
    const onAction = vi.fn()
    renderTestApp(AssetList, { props: {
      ...baseProps,
      assets: [symlink, copied, untracked],
      sourceKind: 'project',
      managementStatuses: {
        [symlink.id]: [{ ...location, path: symlink.path, method: 'symlink' as const }],
        [copied.id]: [{ ...location, path: copied.path, method: 'copy' as const }],
        [untracked.id]: [{ ...location, path: untracked.path, method: null, installationId: null }],
      },
    }, attrs: { onAction } })

    expect(await screen.findByText('软链接')).toBeInTheDocument()
    expect(screen.getByText('复制')).toBeInTheDocument()
    expect(screen.getAllByText('未受管').filter((element) => element.closest('tr'))).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '冻结 Linked Skill' })).toBeNull()
    expect(screen.queryByRole('button', { name: '解冻 Linked Skill' })).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: '卸载 Linked Skill' }))
    expect(onAction).toHaveBeenCalledWith('uninstall', symlink, expect.objectContaining({ method: 'symlink' }))
  })

  it('stacks the resource name, installation tags, and metadata without orphan separators', async () => {
    const asset = { ...active, description: '' }
    renderTestApp(AssetList, { props: {
      ...baseProps,
      assets: [asset],
      sourceKind: 'project',
      managementStatuses: { [asset.id]: [{ ...location, method: 'symlink' as const }] },
    } })

    const name = await screen.findByText('Skill One')
    const content = name.closest('.asset-copy')
    expect(Array.from(content?.children ?? []).map((element) => element.textContent?.trim())).toEqual([
      'Skill One',
      'Codex软链接',
      'backend',
    ])
    expect(content?.textContent).not.toContain('·')
    expect(name.closest('tr')?.querySelector('.status-tag')?.closest('td')?.textContent?.trim()).toBe('最新')
  })

  it('uses thaw for frozen Skills and update for outdated assets', async () => {
    const frozen = { ...active, id: 'codex:frozen', name: 'Frozen Skill', entryState: 'frozen' as const, entryPath: `${active.path}/SKILL.md.xc-disabled` }
    const outdated = { ...active, id: 'codex:old', name: 'Old Skill' }
    renderTestApp(AssetList, { props: {
      ...baseProps, assets: [frozen, outdated], sourceKind: 'project', managementStatuses: {
        [frozen.id]: [{ ...location, path: frozen.path, status: { ...location.status, status: 'frozen' as const } }],
        [outdated.id]: [{ ...location, path: outdated.path, status: { ...location.status, status: 'update_available' as const, updateAvailable: true } }],
      },
    } })
    expect(await screen.findByRole('button', { name: '解冻 Frozen Skill' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '更新 Old Skill' })).toBeInTheDocument()
  })

  it('offers batch update when every selected resource has an available update', () => {
    const outdated = { ...active, id: 'codex:old', name: 'Old Skill' }
    renderTestApp(AssetList, { props: {
      ...baseProps,
      assets: [outdated],
      selectedIds: [outdated.id],
      sourceKind: 'project',
      managementStatuses: { [outdated.id]: [outdatedLocation] },
    } })

    expect(screen.getByRole('button', { name: '批量更新' })).toBeEnabled()
  })

  it('allows batch update for symlink resources with an available repository update', () => {
    const outdated = { ...active, id: 'codex:symlink-old', name: 'Symlink Skill' }
    renderTestApp(AssetList, {
      props: {
        ...baseProps,
        assets: [outdated],
        selectedIds: [outdated.id],
        sourceKind: 'project',
        managementStatuses: {
          [outdated.id]: [{ ...outdatedLocation, method: 'symlink', path: outdated.path }],
        },
      },
    })

    expect(screen.getByRole('button', { name: '批量更新' })).toBeEnabled()
  })

  it('offers installation directly on central repository rows without selecting the row', async () => {
    const user = userEvent.setup()
    const centralAsset = { ...active, agentId: undefined }
    const onSelect = vi.fn()
    const onAction = vi.fn()
    renderTestApp(AssetList, {
      props: { ...baseProps, assets: [centralAsset], sourceKind: 'central', managementStatuses: {} },
      attrs: { onSelect, onAction },
    })

    await user.click(await screen.findByRole('button', { name: '安装到… Skill One' }))
    expect(onAction).toHaveBeenCalledWith('install', centralAsset)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /冻结|解冻|更新|更多操作/ })).toBeNull()
  })

  it('summarizes repository asset status across all installation targets', async () => {
    const thirdPartyAsset = { ...active, id: 'third-party:ask-matt', name: 'ask-matt', agentId: undefined }
    const notInstalled = {
      ...location,
      projectId: null,
      agentId: 'antigravity',
      path: '/Users/me/.agents/skills/ask-matt',
      method: null,
      status: {
        ...location.status,
        status: 'not_installed' as const,
        sourceHash: null,
        installedHash: null,
        reason: 'not installed',
      },
    }
    const installed = {
      ...location,
      projectId: 'project-1',
      agentId: 'codex',
      path: '/project/.codex/skills/ask-matt',
      method: 'symlink' as const,
      status: { ...location.status, status: 'current' as const },
    }

    renderTestApp(AssetList, {
      props: {
        ...baseProps,
        assets: [thirdPartyAsset],
        sourceKind: 'third-party',
        managementStatuses: { [thirdPartyAsset.id]: [notInstalled, installed] },
      },
    })

    expect(await screen.findByText('已安装')).toBeInTheDocument()
    expect(screen.queryByText('未安装')).toBeNull()
  })

  it('labels unmatched central assets as non-repository resources while preserving genuine unknown failures', async () => {
    const failed = { ...active, id: 'codex:failed', name: 'Failed Skill' }
    renderTestApp(AssetList, { props: {
      ...baseProps, assets: [active, failed], sourceKind: 'project', managementStatuses: {
        [active.id]: [{ ...location, status: { ...location.status, status: 'unknown' as const, sourceHash: null, installedHash: null, sourceVersion: null, installedVersion: null, reason: '中央分支不存在同名资产' } }],
        [failed.id]: [{ ...location, status: { ...location.status, status: 'unknown' as const, sourceHash: null, installedHash: null, sourceVersion: null, installedVersion: null, reason: '无法计算资产状态' } }],
      },
    } })

    expect(await screen.findByText('非仓库资源')).toBeInTheDocument()
    expect(await screen.findByText('未知')).toBeInTheDocument()
  })

  it('labels removed sources, disables update, and keeps recovery and removal actions', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const unavailable = {
      ...location,
      status: { ...location.status, status: 'source_unavailable' as const, updateAvailable: false, reason: 'registered repository was removed' },
    }
    renderTestApp(AssetList, { props: {
      ...baseProps, assets: [active], sourceKind: 'project', managementStatuses: { [active.id]: [unavailable] },
    }, attrs: { onAction } })

    const unavailableStatus = await screen.findByText('来源已移除')
    const statusCell = unavailableStatus.closest('td')
    const statusColumnName = Array.from(statusCell?.classList ?? []).find((name) => name.startsWith('el-table_') && name.includes('_column_'))
    const statusColumn = document.querySelector(`col[name="${statusColumnName}"]`)
    expect(Number(statusColumn?.getAttribute('width'))).toBeGreaterThanOrEqual(116)
    expect(statusCell?.textContent?.trim()).toBe('来源已移除')
    expect(screen.queryByRole('button', { name: '更新 Skill One' })).toBeNull()
    expect(await screen.findByRole('button', { name: '冻结 Skill One' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: '更多操作 Skill One' }))
    expect(await screen.findByText('重新关联来源')).toBeInTheDocument()
    expect(screen.getByText('卸载')).toBeInTheDocument()
  })

  it('distinguishes an empty source from filters with no matches', async () => {
    const user = userEvent.setup()
    const empty = renderTestApp(AssetList, {
      props: { ...baseProps, assets: [], sourceKind: 'central' },
    })

    expect(screen.getByRole('heading', { name: '这里还没有资源' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '清除筛选' })).toBeNull()
    empty.unmount()

    const onClearFilters = vi.fn()
    renderTestApp(AssetList, {
      props: { ...baseProps, assets: [active], sourceKind: 'project', query: 'missing' },
      attrs: { onClearFilters },
    })

    expect(screen.getByRole('heading', { name: '没有找到匹配资源' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清除筛选' }))
    expect(onClearFilters).toHaveBeenCalledOnce()
  })

  it('selects every resource in the current filtered result without opening details', async () => {
    const user = userEvent.setup()
    const apiOne = { ...active, id: 'skill-api-1', name: 'API One' }
    const apiTwo = { ...active, id: 'skill-api-2', name: 'API Two' }
    const hidden = { ...active, id: 'skill-form', name: 'Form Builder' }
    const onUpdateSelectedIds = vi.fn()
    const onSelect = vi.fn()
    renderTestApp(AssetList, {
      props: { ...baseProps, assets: [apiOne, apiTwo, hidden], sourceKind: 'central', query: 'api' },
      attrs: { 'onUpdate:selectedIds': onUpdateSelectedIds, onSelect },
    })

    await user.click(await screen.findByRole('checkbox', { name: /选择所有行|Select all rows/ }))

    await waitFor(() => expect(onUpdateSelectedIds).toHaveBeenLastCalledWith(['skill-api-1', 'skill-api-2']))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps batch actions visible below the filters when no resource is selected', () => {
    renderTestApp(AssetList, {
      props: { ...baseProps, assets: [active], sourceKind: 'central' },
    })

    expect(screen.getByText('已选择 0 项')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批量安装' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '清空选择' })).toBeDisabled()
  })

  it('blocks incompatible batch actions without exposing inline validation messages', () => {
    const frozen = { ...active, id: 'codex:frozen', name: 'Frozen Skill', entryState: 'frozen' as const }
    const frozenLocation = {
      ...location,
      path: frozen.path,
      status: { ...location.status, status: 'frozen' as const },
    }
    renderTestApp(AssetList, { props: {
      ...baseProps,
      assets: [active, frozen],
      selectedIds: [active.id, frozen.id],
      sourceKind: 'project',
      managementStatuses: {
        [active.id]: [location],
        [frozen.id]: [frozenLocation],
      },
    } })

    expect(screen.getByText('已选择 2 项')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批量冻结' })).toBeDisabled()
    expect(screen.queryByText('Frozen Skill：资源已经冻结')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批量解冻' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '批量卸载' })).toBeEnabled()
  })
})
