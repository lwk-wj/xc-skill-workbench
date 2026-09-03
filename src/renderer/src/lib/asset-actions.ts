import type { AssetRecord, AssetStatusLocation, SourceSelection } from '../../../shared/ipc.js'

export type AssetActionKind = 'install' | 'update' | 'update-with-warning' | 'freeze' | 'thaw' | 'uninstall' | 'relink-source'
export type AssetAction = { kind: AssetActionKind; label: string }
export type BatchActionKind = 'install' | 'freeze' | 'thaw' | 'uninstall'
export type ActionEligibility = { eligible: true } | { eligible: false; reason: string }

export type AssetActionInput = {
  sourceKind: SourceSelection['kind']
  asset: AssetRecord
  location: AssetStatusLocation | null
}

const isRepositorySource = (sourceKind: SourceSelection['kind']): boolean => sourceKind === 'central' || sourceKind === 'third-party'
const isFrozen = ({ asset, location }: AssetActionInput): boolean => asset.entryState === 'frozen' || location?.status.status === 'frozen'

export const primaryAssetAction = (input: AssetActionInput): AssetAction | null => {
  if (isRepositorySource(input.sourceKind)) return { kind: 'install', label: '安装到…' }
  const status = input.location?.status.status
  if (input.asset.type === 'skills' && isFrozen(input)) return { kind: 'thaw', label: '解冻' }
  if (status === 'locally_modified') return { kind: 'update-with-warning', label: '查看影响并更新' }
  if (status === 'update_available') return { kind: 'update', label: '更新' }
  if (input.asset.type === 'skills' && input.asset.entryState === 'active') return { kind: 'freeze', label: '冻结' }
  return null
}

export const overflowAssetActions = (input: AssetActionInput): AssetAction[] => {
  if (isRepositorySource(input.sourceKind) || !input.location) return []
  const primary = primaryAssetAction(input)
  const status = input.location.status.status
  return [
    ...(status === 'source_unavailable' ? [{ kind: 'relink-source', label: '重新关联来源' } as const] : []),
    ...(input.asset.type === 'skills' && input.asset.entryState === 'active' && primary?.kind !== 'freeze'
      ? [{ kind: 'freeze', label: '冻结' } as const]
      : []),
    { kind: 'uninstall', label: '卸载' },
  ]
}

export const batchActionEligibility = ({ action, sourceKind, asset, location }: AssetActionInput & { action: BatchActionKind }): ActionEligibility => {
  if (action === 'install') {
    if (!isRepositorySource(sourceKind)) return { eligible: false, reason: '只有仓库资源可以安装' }
    if (asset.entryState === 'invalid') return { eligible: false, reason: '资源无效' }
    if (asset.entryState === 'conflict') return { eligible: false, reason: '资源存在冲突' }
    return { eligible: true }
  }
  if (!location) return { eligible: false, reason: '缺少受管安装位置' }
  if (action === 'uninstall') return { eligible: true }
  if (action === 'freeze') {
    if (isFrozen({ sourceKind, asset, location })) return { eligible: false, reason: '资源已经冻结' }
    if (location.status.status === 'broken_link' || location.status.status === 'conflict' || location.status.status === 'invalid') {
      return { eligible: false, reason: '资源状态不允许冻结' }
    }
    return { eligible: true }
  }
  if (!isFrozen({ sourceKind, asset, location })) return { eligible: false, reason: '资源尚未冻结' }
  return { eligible: true }
}
