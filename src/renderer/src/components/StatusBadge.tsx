export function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = { active: '正常', frozen: '已冻结', conflict: '冲突', invalid: '无效', current: '已安装', update_available: '可更新' }
  return <span className={`status-badge status-${status}`}>{labels[status] ?? status}</span>
}
