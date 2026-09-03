// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AssetList from '../../src/renderer/src/components/AssetList.vue'
import { renderTestApp } from '../../src/renderer/src/app/render-test-app'
import type { AssetRecord } from '../../src/shared/ipc.js'

const active: AssetRecord = {
  id: 'codex:skill-one', type: 'skills', name: 'Skill One', group: 'backend', agentId: 'codex',
  path: '/project/.codex/skills/skill-one', entryPath: '/project/.codex/skills/skill-one/SKILL.md',
  entryState: 'active', description: 'fixture', version: '1.0.0',
}

const location = {
  projectId: 'proj', agentId: 'codex', path: active.path, method: 'copy' as const,
  status: { status: 'current' as const, updateAvailable: false, locallyModified: false, sourceHash: 'a', installedHash: 'a', sourceVersion: '1.0.0', installedVersion: '1.0.0', resolvedTarget: null, reason: '' },
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

    await user.click(screen.getByRole('button', { name: '冻结 Skill One' }))
    expect(onAction).toHaveBeenCalledWith('freeze', active, location)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '更多操作 Skill One' })).toBeInTheDocument()
  })

  it('uses thaw for frozen Skills and update for outdated assets', () => {
    const frozen = { ...active, id: 'codex:frozen', name: 'Frozen Skill', entryState: 'frozen' as const, entryPath: `${active.path}/SKILL.md.xc-disabled` }
    const outdated = { ...active, id: 'codex:old', name: 'Old Skill' }
    renderTestApp(AssetList, { props: {
      ...baseProps, assets: [frozen, outdated], sourceKind: 'project', managementStatuses: {
        [frozen.id]: [{ ...location, path: frozen.path, status: { ...location.status, status: 'frozen' as const } }],
        [outdated.id]: [{ ...location, path: outdated.path, status: { ...location.status, status: 'update_available' as const, updateAvailable: true } }],
      },
    } })
    expect(screen.getByRole('button', { name: '解冻 Frozen Skill' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '更新 Old Skill' })).toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: '安装到… Skill One' }))
    expect(onAction).toHaveBeenCalledWith('install', centralAsset)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /冻结|解冻|更新|更多操作/ })).toBeNull()
  })

  it('labels unmatched central assets as non-repository resources while preserving genuine unknown failures', () => {
    const failed = { ...active, id: 'codex:failed', name: 'Failed Skill' }
    renderTestApp(AssetList, { props: {
      ...baseProps, assets: [active, failed], sourceKind: 'project', managementStatuses: {
        [active.id]: [{ ...location, status: { ...location.status, status: 'unknown' as const, sourceHash: null, installedHash: null, sourceVersion: null, installedVersion: null, reason: '中央分支不存在同名资产' } }],
        [failed.id]: [{ ...location, status: { ...location.status, status: 'unknown' as const, sourceHash: null, installedHash: null, sourceVersion: null, installedVersion: null, reason: '无法计算资产状态' } }],
      },
    } })

    expect(screen.getByText('非仓库资源')).toBeInTheDocument()
    expect(screen.getByText('未知')).toBeInTheDocument()
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

    expect(screen.getByText('来源已移除')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '更新 Skill One' })).toBeNull()
    expect(screen.getByRole('button', { name: '冻结 Skill One' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '更多操作 Skill One' }))
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

    await user.click(screen.getByRole('checkbox', { name: '全选当前筛选结果' }))

    expect(onUpdateSelectedIds).toHaveBeenLastCalledWith(['skill-api-1', 'skill-api-2'])
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('blocks a batch action when any selected resource has an incompatible state', () => {
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
    expect(screen.getByText('Frozen Skill：资源已经冻结')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批量解冻' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '批量卸载' })).toBeEnabled()
  })
})
