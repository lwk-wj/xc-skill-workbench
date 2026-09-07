import { describe, expect, it } from 'vitest'
import {
  batchActionEligibility,
  overflowAssetActions,
  primaryAssetAction,
} from '../../src/renderer/src/lib/asset-actions'
import type { AssetRecord, AssetStatusLocation, SourceSelection } from '../../src/shared/ipc.js'

const active: AssetRecord = {
  id: 'codex:skill-one', type: 'skills', name: 'Skill One', group: 'backend', agentId: 'codex',
  sourceRelativePath: 'backend/skills/skill-one',
  path: '/project/.codex/skills/skill-one', entryPath: '/project/.codex/skills/skill-one/SKILL.md',
  entryState: 'active', description: 'fixture', version: '1.0.0',
}

const location: AssetStatusLocation = {
  projectId: 'proj', agentId: 'codex', path: active.path, method: 'copy', installationId: 'install-one',
  status: {
    status: 'current', updateAvailable: false, locallyModified: false,
    sourceHash: 'a', installedHash: 'a', sourceVersion: '1.0.0', installedVersion: '1.0.0',
    resolvedTarget: null, reason: '',
  },
}

const frozen = { ...active, id: 'codex:frozen', name: 'Frozen Skill', entryState: 'frozen' as const }
const frozenLocation: AssetStatusLocation = {
  ...location,
  path: frozen.path,
  status: { ...location.status, status: 'frozen' },
}

const symlinkLocation: AssetStatusLocation = {
  ...location,
  method: 'symlink',
}

describe('asset action policy', () => {
  it.each([
    ['install', 'central', active, null, true, null],
    ['install', 'project', active, location, false, '只有仓库资源可以安装'],
    ['freeze', 'project', active, location, true, null],
    ['freeze', 'project', active, symlinkLocation, false, '软链接资源不支持冻结'],
    ['freeze', 'project', frozen, frozenLocation, false, '资源已经冻结'],
    ['thaw', 'project', frozen, frozenLocation, true, null],
    ['thaw', 'project', frozen, { ...frozenLocation, method: 'symlink' }, false, '软链接资源不支持解冻'],
    ['thaw', 'project', active, location, false, '资源尚未冻结'],
    ['uninstall', 'project', active, location, true, null],
    ['uninstall', 'project', active, null, false, '缺少受管安装位置'],
  ] as const)(
    '%s validates %s resources',
    (action, sourceKind, asset, targetLocation, eligible, reason) => {
      const result = batchActionEligibility({
        action,
        sourceKind: sourceKind as SourceSelection['kind'],
        asset,
        location: targetLocation,
      })
      expect(result.eligible).toBe(eligible)
      if (!eligible) expect(result).toEqual({ eligible: false, reason })
    },
  )

  it('preserves repository and installed row actions', () => {
    expect(primaryAssetAction({ sourceKind: 'central', asset: active, location: null }))
      .toEqual({ kind: 'install', label: '安装到…' })
    expect(primaryAssetAction({ sourceKind: 'project', asset: frozen, location: frozenLocation }))
      .toEqual({ kind: 'thaw', label: '解冻' })
    expect(primaryAssetAction({ sourceKind: 'project', asset: active, location }))
      .toEqual({ kind: 'freeze', label: '冻结' })
    expect(primaryAssetAction({ sourceKind: 'project', asset: active, location: symlinkLocation }))
      .toEqual({ kind: 'uninstall', label: '卸载' })
    expect(overflowAssetActions({ sourceKind: 'project', asset: active, location: symlinkLocation }))
      .toEqual([])
  })

  it('keeps recovery and uninstall available when the source was removed', () => {
    const unavailable: AssetStatusLocation = {
      ...location,
      status: { ...location.status, status: 'source_unavailable', reason: 'repository removed' },
    }

    expect(primaryAssetAction({ sourceKind: 'project', asset: active, location: unavailable }))
      .toEqual({ kind: 'freeze', label: '冻结' })
    expect(overflowAssetActions({ sourceKind: 'project', asset: active, location: unavailable }))
      .toEqual([
        { kind: 'relink-source', label: '重新关联来源' },
        { kind: 'uninstall', label: '卸载' },
      ])
  })
})
