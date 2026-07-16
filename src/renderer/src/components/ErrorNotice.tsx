import type { ReactNode } from 'react'

export type StructuredError = {
  code?: string
  message?: string
  path?: string
  paths?: string[]
  resolvedTarget?: string | null
  logPath?: string
  staleAvailable?: boolean
}

type ErrorNoticeProps = {
  error: StructuredError | Error | string | null | undefined
  onRetry?: () => void
  onAction?: () => void
}

const getDetails = (error: ErrorNoticeProps['error']): StructuredError => {
  if (!error) return {}
  if (typeof error === 'string') return { code: 'UNKNOWN', message: error }
  if (error instanceof Error) return { code: 'UNKNOWN', message: error.message }
  return error
}

const safePath = (value: string): string => value.replaceAll(/(?:token|password|secret|authorization)=[^\s&]+/gi, '$1=…')

export function ErrorNotice({ error, onRetry, onAction }: ErrorNoticeProps): ReactNode {
  if (!error) return null
  const details = getDetails(error)
  const code = details.code ?? 'UNKNOWN'
  let title = '操作失败'
  let guidance = '请稍后重试，详细诊断已写入本地日志。'
  let actionLabel: string | undefined
  if (code === 'PERMISSION_DENIED') {
    title = '没有访问权限'
    guidance = '请在 Finder 中检查权限后重试。'
  } else if (code === 'GIT_FAILED' || code === 'NETWORK_FAILED') {
    title = '无法同步仓库'
    guidance = details.staleAvailable === false ? '网络恢复后重试。' : '可继续使用最近一次成功的缓存。'
    actionLabel = '重试'
  } else if (code === 'BROKEN_LINK') {
    title = '发现断裂软链接'
    guidance = '请选择卸载或修复计划来处理该入口。'
    actionLabel = '查看修复计划'
  } else if (code === 'ENTRY_CONFLICT') {
    title = '入口路径冲突'
    guidance = '请先解决冲突；冻结和解冻暂不可用。'
  } else if (code === 'ROLLBACK_FAILED') {
    title = '回滚未完成'
    guidance = '请保留以下残留路径并联系维护者处理。'
  }
  const paths = [...(details.paths ?? []), ...(details.path ? [details.path] : [])]
  const target = details.resolvedTarget ? [details.resolvedTarget] : []
  return <section className={`error-notice error-${code.toLowerCase()}`} role="alert" aria-label={title}>
    <strong>{title}</strong>
    <p>{guidance}</p>
    {target.length > 0 && <p className="error-paths">目标：{target.map((path) => <code key={path}>{safePath(path)}</code>)}</p>}
    {paths.length > 0 && <ul className="error-paths">{paths.map((path) => <li key={path}><code>{safePath(path)}</code></li>)}</ul>}
    {details.logPath && <p className="error-log">日志：<code>{safePath(details.logPath)}</code></p>}
    {(actionLabel || onRetry) && <button type="button" onClick={actionLabel === '重试' ? onRetry : onAction}>{actionLabel ?? '重试'}</button>}
  </section>
}

export const errorCode = (error: unknown): string => getDetails(error as ErrorNoticeProps['error']).code ?? 'UNKNOWN'
