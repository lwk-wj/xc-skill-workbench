import { useEffect, useMemo, useState } from 'react'
import type {
  AgentDefinition, AssetRecord, InstallMethod, OperationKind, OperationPlan, OperationProgress as ProgressEvent,
  OperationRequest, OperationResult, ProjectRecord,
} from '../../../../shared/ipc.js'
import { OperationProgress } from './OperationProgress'

type PlanFn = (request: OperationRequest) => Promise<OperationPlan>
type ExecuteFn = (planId: string) => Promise<OperationResult>
type CancelFn = (planId: string) => Promise<void>
type Target = { scope: 'project' | 'global'; projectId?: string; agentId: string }

export interface OperationDialogProps {
  open: boolean
  kind: OperationKind
  asset: AssetRecord
  projects: ProjectRecord[]
  agents: AgentDefinition[]
  onClose: () => void
  plan: PlanFn
  execute: ExecuteFn
  cancel: CancelFn
  /** Existing installed location, used by update/uninstall/freeze/thaw. */
  location?: { projectId: string | null; agentId: string; path: string }
  /** Source selection defaults to the central catalog. */
  source?: OperationRequest['asset']['source']
  allowSymlink?: boolean
  onRescan?: (paths: string[]) => void
  progressEvents?: (listener: (progress: ProgressEvent) => void) => () => void
}

const destructiveKinds = new Set<OperationKind>(['uninstall', 'freeze', 'thaw', 'update'])

export function OperationDialog({ open, kind, asset, projects, agents, onClose, plan, execute, cancel, location, source = { kind: 'central' }, allowSymlink = true, onRescan, progressEvents }: OperationDialogProps) {
  const enabledAgents = useMemo(() => agents.filter((agent) => agent.enabled), [agents])
  const defaultScope: 'global' | 'project' = location?.projectId ? 'project' : 'global'
  const [scope, setScope] = useState<'global' | 'project'>(defaultScope)
  const [projectId, setProjectId] = useState<string | undefined>(location?.projectId ?? projects[0]?.id)
  const [selectedAgents, setSelectedAgents] = useState<string[]>(location ? [location.agentId] : enabledAgents.map((agent) => agent.id))
  const [method, setMethod] = useState<InstallMethod>(allowSymlink ? 'copy' : 'copy')
  const [plans, setPlans] = useState<OperationPlan[]>([])
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState<'preview' | 'confirm' | 'executing' | 'done'>('preview')
  const [current, setCurrent] = useState(0)
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [result, setResult] = useState<OperationResult | null>(null)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (!open) return
    setScope(defaultScope)
    setProjectId(location?.projectId ?? projects[0]?.id)
    setSelectedAgents(location ? [location.agentId] : enabledAgents.map((agent) => agent.id))
    setPlans([]); setError(null); setStage('preview'); setCurrent(0); setProgress(null); setResult(null); setCancelling(false)
  }, [open, asset.id, kind, location?.projectId, location?.agentId, enabledAgents, projects, defaultScope])

  useEffect(() => {
    if (!open || stage !== 'preview' || selectedAgents.length === 0) return
    let cancelled = false
    const targets: Target[] = selectedAgents.map((agentId) => ({
      scope: location ? (location.projectId ? 'project' : 'global') : scope,
      ...(location?.projectId || (scope === 'project' ? projectId : undefined) ? { projectId: location?.projectId ?? projectId } : {}),
      agentId,
    }))
    void Promise.all(targets.map((target) => plan({
      kind, asset: { source, assetId: asset.id }, target,
      method: kind === 'install' || kind === 'update' ? method : null,
      overwriteModified: false,
    }))).then((nextPlans) => { if (!cancelled) setPlans(nextPlans) }).catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : '无法生成操作计划') })
    return () => { cancelled = true }
  }, [open, stage, selectedAgents, scope, projectId, method, kind, asset.id, source, location])

  useEffect(() => progressEvents?.(setProgress), [progressEvents])

  if (!open) return null
  const allSteps = plans.flatMap((entry) => entry.steps)
  const warnings = plans.flatMap((entry) => entry.warnings)
  const hasOverwrite = plans.some((entry) => entry.requiresOverwriteConfirmation)
  const predictedPaths = selectedAgents.map((agentId) => {
    const agent = enabledAgents.find((entry) => entry.id === agentId)
    const base = scope === 'project' ? (agent?.projectBaseDir ?? '') : (agent?.globalBaseDir ?? '')
    const assetDir = agent?.assetDirs[asset.type] ?? `/${asset.type}`
    const root = `${base.replace(/\/$/, '')}/${assetDir.replace(/^\//, '').replace(/\/$/, '')}`
    return `${root}/${asset.name}`
  })
  const affected = [...new Set(allSteps.length ? allSteps.map((step) => step.target) : predictedPaths)]
  const targetLabel = scope === 'global' ? '全局' : projects.find((project) => project.id === projectId)?.name ?? projectId ?? '项目'
  const toggleAgent = (id: string) => setSelectedAgents((currentIds) => currentIds.includes(id) ? currentIds.filter((item) => item !== id) : [...currentIds, id])

  const startExecution = async () => {
    if (plans.length === 0) return
    setStage('executing'); setError(null); setProgress(null)
    let last: OperationResult | null = null
    try {
      for (let index = 0; index < plans.length; index += 1) {
        setCurrent(index)
        last = await execute(plans[index]!.id)
        if (last.status !== 'completed') break
        onRescan?.(last.affectedPaths)
      }
      setResult(last)
      setStage('done')
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : '操作失败')
      setStage('done')
    }
  }
  const cancelExecution = async () => {
    const active = plans[current]
    if (!active) return
    setCancelling(true)
    try { await cancel(active.id) } finally { setCancelling(false) }
  }

  return <div className="operation-dialog-backdrop" role="presentation">
    <section className="operation-dialog" role="dialog" aria-modal="true" aria-label="资源操作">
      <header><h2>{kind === 'install' ? '安装资源' : kind === 'update' ? '更新资源' : kind === 'uninstall' ? '卸载资源' : kind === 'freeze' ? '冻结资源' : '解冻资源'}</h2><button type="button" aria-label="关闭" onClick={onClose}>×</button></header>
      {error && <div role="alert">{error}</div>}
      {(stage === 'preview' || stage === 'confirm') && <>
        {kind === 'install' && !location && <div className="operation-targets">
          <label>目标范围<select aria-label="目标范围" value={scope} onChange={(event) => setScope(event.target.value as 'global' | 'project')}><option value="global">全局</option><option value="project">项目</option></select></label>
          {scope === 'project' && <label>项目<select aria-label="目标项目" value={projectId ?? ''} onChange={(event) => setProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
          <fieldset><legend>启用的 Agent</legend>{enabledAgents.map((agent) => <label key={agent.id}><input type="checkbox" checked={selectedAgents.includes(agent.id)} onChange={() => toggleAgent(agent.id)} />{agent.name}</label>)}</fieldset>
          <fieldset><legend>安装方式</legend><label><input type="radio" name="operation-method" value="copy" checked={method === 'copy'} onChange={() => setMethod('copy')} />复制</label>{allowSymlink && <label><input type="radio" name="operation-method" value="symlink" checked={method === 'symlink'} onChange={() => setMethod('symlink')} />软链接</label>}</fieldset>
        </div>}
        <p>目标：{targetLabel} · {asset.name}</p>
        {affected.length > 0 && <section aria-label="受影响路径"><h3>受影响路径</h3><ul>{affected.map((path) => <li key={path}><code>{path}</code></li>)}</ul></section>}
        {warnings.map((warning) => <div role="alert" key={warning}>{warning}</div>)}
        {(hasOverwrite || (kind === 'install' && plans.length === 0)) && <p role="alert"><span>本地有修改</span>，确认后将覆盖。</p>}
        {kind === 'uninstall' && location && <p>仅删除选中的资源：<code>{location.path}</code></p>}
        {stage === 'preview' && <button type="button" onClick={() => setStage('confirm')} disabled={!selectedAgents.length}>确认并继续</button>}
        {stage === 'confirm' && <><p role="alert">此操作不可逆，请确认执行。</p><button type="button" onClick={() => void startExecution()}>确认执行</button></>}
      </>}
      {stage === 'executing' && <OperationProgress progress={progress ?? { planId: plans[current]?.id ?? 'operation', completed: 0, total: allSteps.length || plans.length, message: `执行 ${current + 1}/${plans.length}` }} onCancel={() => void cancelExecution()} cancelling={cancelling} />}
      {stage === 'done' && <><OperationProgress progress={progress} result={result} />{!error && <button type="button" onClick={onClose}>完成</button>}</>}
    </section>
  </div>
}
