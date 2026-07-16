import { useEffect, useMemo, useState } from 'react'
import type { AssetDetail as AssetDetailRecord, AssetRecord, AssetSelection, AssetStatusRecord, InstallMethod, SourceSelection } from '../../../shared/ipc.js'
import { AssetFileTree } from './AssetFileTree'
import { handleSafeMarkdownClick, renderSafeMarkdown } from '../lib/markdown'

const MAX_TEXT_BYTES = 1024 * 1024
type StatusLocation = Awaited<ReturnType<NonNullable<Window['xcSkills']>['assets']['statuses']>>[number]
type DetailLoader = (selection: AssetSelection) => Promise<AssetDetailRecord>
type StatusLoader = (selection: AssetSelection) => Promise<StatusLocation[]>
type Action = (kind: string, location: StatusLocation) => void

const statusLabels: Record<AssetStatusRecord['status'], string> = {
  not_installed: '未安装', current: '最新', update_available: '可更新', locally_modified: '本地有修改',
  frozen: '已冻结', broken_link: '链接失效', conflict: '冲突', invalid: '无效', unknown: '未知',
}
const locationName = (location: StatusLocation) => location.projectId ? location.projectId : 'Global'
const methodName = (method: InstallMethod | null) => method ?? '—'
const defaultLoadDetail: DetailLoader = (selection) => window.xcSkills.assets.detail(selection)
const defaultLoadStatuses: StatusLoader = (selection) => window.xcSkills.assets.statuses(selection)

function ActionButtons({ asset, location, onAction }: { asset: AssetRecord; location: StatusLocation; onAction?: Action }) {
  const status = location.status.status
  const button = (label: string, kind: string) => <button type="button" data-operation-kind={kind} aria-label={`${label} ${asset.name}`} onClick={() => onAction?.(kind, location)}>{label}</button>
  if (status === 'not_installed') return button('安装到…', 'install')
  if (status === 'update_available') return button('更新', 'update')
  if (status === 'locally_modified') return button('查看影响并更新', 'update-with-warning')
  if (status === 'current') return <>{button('卸载', 'uninstall')}{asset.type === 'skills' && button('冻结', 'freeze')}</>
  if (status === 'frozen') return asset.type === 'skills' ? <>{button('解冻', 'thaw')}{button('卸载', 'uninstall')}{button('更新', 'update')}</> : button('查看诊断', 'diagnose')
  if (status === 'broken_link' || status === 'conflict' || status === 'invalid') return button('查看诊断', 'diagnose')
  return null
}

export function AssetDetail({ asset, source = { kind: 'central' }, loadDetail = defaultLoadDetail, loadStatuses = defaultLoadStatuses, onAction }: { asset: AssetRecord; source?: SourceSelection; loadDetail?: DetailLoader; loadStatuses?: StatusLoader; onAction?: Action }) {
  const [detail, setDetail] = useState<AssetDetailRecord | null>(null)
  const [statuses, setStatuses] = useState<StatusLocation[]>([])
  const [tab, setTab] = useState<'preview' | 'source' | 'files' | 'evolution'>('preview')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const selection = { source, assetId: asset.id }
    setDetail(null)
    setStatuses([])
    setError(null)
    setTab('preview')
    void Promise.all([loadDetail(selection), loadStatuses(selection)]).then(([nextDetail, nextStatuses]) => {
      if (cancelled) return
      setDetail(nextDetail)
      setStatuses(nextStatuses)
    }).catch((cause: unknown) => {
      if (cancelled) return
      setError(cause instanceof Error ? cause.message : '加载详情失败')
    })
    return () => { cancelled = true }
  }, [asset.id, source.kind, source.kind === 'project' ? source.projectId : undefined, loadDetail, loadStatuses])

  const groupedStatuses = useMemo(() => [...statuses].sort((a, b) => {
    if (a.projectId === null && b.projectId !== null) return -1
    if (a.projectId !== null && b.projectId === null) return 1
    return `${a.projectId ?? ''}/${a.agentId}/${a.path}`.localeCompare(`${b.projectId ?? ''}/${b.agentId}/${b.path}`)
  }), [statuses])
  const textWithinLimit = (value: string | null): value is string => Boolean(value && new TextEncoder().encode(value).byteLength <= MAX_TEXT_BYTES)
  const markdown = detail?.markdown ?? null
  const renderedMarkdown = textWithinLimit(markdown) ? renderSafeMarkdown(markdown) : ''
  const showTextLimit = Boolean(markdown && !textWithinLimit(markdown))
  const metadataOnly = Boolean(detail && !markdown && detail.files.some((file) => file.kind === 'binary' || file.size > MAX_TEXT_BYTES))

  return <section className="asset-detail" aria-label="资源详情">
    <header className="asset-detail-header"><h2>{asset.name}</h2><small>{asset.group} · {asset.version ?? '无版本'}</small></header>
    {error && <div role="alert" className="detail-error">{error}</div>}
    {!detail && !error && <div role="status">正在加载详情…</div>}
    {detail && <>
      <div className="detail-tabs" role="tablist" aria-label="详情视图">
        <button role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>预览</button>
        <button role="tab" aria-selected={tab === 'source'} onClick={() => setTab('source')}>源码</button>
        <button role="tab" aria-selected={tab === 'files'} onClick={() => setTab('files')}>文件</button>
        {asset.type === 'skills' && <button role="tab" aria-selected={tab === 'evolution'} onClick={() => setTab('evolution')}>演进历史</button>}
      </div>
      <div className="detail-content" role="tabpanel">
        {tab === 'preview' && (showTextLimit || metadataOnly ? <p className="detail-muted">{metadataOnly ? '文件为二进制或过大，仅显示文件元数据。' : '文件过大，仅显示文件元数据。'}</p> : <div data-testid="markdown-preview" onClick={handleSafeMarkdownClick} dangerouslySetInnerHTML={{ __html: renderedMarkdown }} />)}
        {tab === 'source' && (showTextLimit || metadataOnly ? <p className="detail-muted">{metadataOnly ? '文件为二进制或过大，无法显示源码。' : '文件过大，无法显示源码。'}</p> : <pre className="markdown-source">{detail.markdown ? <><span>{detail.markdown.split('\n')[0]}</span>{detail.markdown.includes('\n') ? `\n${detail.markdown.split('\n').slice(1).join('\n')}` : ''}</> : '暂无源码'}</pre>)}
        {tab === 'files' && <AssetFileTree files={detail.files} />}
        {tab === 'evolution' && asset.type === 'skills' && <div data-testid="evolution-content">{textWithinLimit(detail.evolution) ? <><div onClick={handleSafeMarkdownClick} dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(detail.evolution) }} /><pre className="sr-only">{detail.evolution}</pre></> : <p className="detail-muted">{detail.evolution ? '文件过大，无法显示演进历史。' : '暂无演进历史'}</p>}</div>}
      </div>
      <section className="asset-statuses" aria-label="安装状态"><h3>安装状态</h3>
        {!groupedStatuses.length && <p className="detail-muted">暂无安装位置</p>}
        {groupedStatuses.map((location, index) => <article className="status-location" key={`${location.projectId ?? 'global'}:${location.agentId}:${location.path}:${index}`}>
          <div className="status-location-copy"><strong>{locationName(location)}</strong><span>Agent: {location.agentId || '—'}</span><span className="sr-only">{location.agentId || '—'}</span><code>{location.path}</code><span>{statusLabels[location.status.status]}</span><span>{methodName(location.method)}</span></div>
          <div className="status-actions"><ActionButtons asset={asset} location={location} onAction={onAction} /></div>
        </article>)}
      </section>
    </>}
  </section>
}
