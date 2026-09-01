import type { AssetStatusRecord } from '../../../shared/ipc.js'

const labels: Record<AssetStatusRecord['status'], string> = {
  not_installed: '未安装',
  current: '最新',
  update_available: '可更新',
  locally_modified: '本地有修改',
  frozen: '已冻结',
  broken_link: '链接失效',
  conflict: '冲突',
  invalid: '无效',
  unknown: '未知',
  source_unavailable: '来源已移除',
}

export const assetStatusLabel = (status: AssetStatusRecord): string => {
  if (status.status === 'unknown' && status.reason.includes('中央分支不存在同名资产')) return '非仓库资源'
  return labels[status.status]
}
