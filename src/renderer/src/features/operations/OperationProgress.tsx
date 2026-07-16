import type { OperationProgress as ProgressEvent, OperationResult } from '../../../../shared/ipc.js'

export function OperationProgress({
  progress,
  result,
  onCancel,
  cancelling = false,
}: {
  progress: ProgressEvent | null
  result?: OperationResult | null
  onCancel?: () => void
  cancelling?: boolean
}) {
  const total = progress?.total ?? 0
  const completed = Math.min(progress?.completed ?? 0, total || Number.MAX_SAFE_INTEGER)
  const percent = total > 0 ? Math.round((completed / total) * 100) : result ? 100 : 0
  const statusLabel = result?.status === 'completed' ? '操作完成'
    : result?.status === 'cancelled' ? '操作已取消'
      : result?.status === 'rolled_back' ? '操作已回滚'
        : result?.status === 'needs_attention' ? '操作需要处理' : '正在执行…'
  return <section className="operation-progress" aria-label="操作进度">
    <h3>{statusLabel}</h3>
    <progress max={100} value={percent} aria-label="操作进度" />
    <span>{progress?.message ?? (result ? result.status : '准备中')}</span>
    {progress && <small>{completed}/{total}</small>}
    {result?.residualPaths?.length ? <div role="alert">需要处理的路径：{result.residualPaths.map((path) => <code key={path}>{path}</code>)}</div> : null}
    {!result && onCancel && <button type="button" onClick={onCancel} disabled={cancelling}>{cancelling ? '正在取消…' : '取消操作'}</button>}
  </section>
}
