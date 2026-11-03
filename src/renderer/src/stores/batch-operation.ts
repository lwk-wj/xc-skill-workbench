import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  AgentDefinition,
  AssetRecord,
  AssetStatusLocation,
  InstallMethod,
  OperationPlan,
  OperationProgress,
  OperationRequest,
  OperationResult,
  ProjectRecord,
  SourceLayoutMigrationPreview,
  SourceSelection,
} from '../../../shared/ipc.js'
import { plainSource } from '../app/types'
import type { BatchActionKind } from '../lib/asset-actions'

export type BatchOperationStage = 'closed' | 'configure' | 'preview' | 'confirm' | 'executing' | 'done'
export type BatchExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'not_run'
export type BatchOperationItem = { asset: AssetRecord; location: AssetStatusLocation | null }
export type BatchPlanEntry = {
  key: string
  asset: AssetRecord
  agentId: string
  agentName: string
  request: OperationRequest
  plan: OperationPlan | null
  planningError: string | null
}
export type BatchExecutionEntry = BatchPlanEntry & {
  status: BatchExecutionStatus
  result: OperationResult | null
  error: string | null
}
export type OpenBatchOperation = {
  kind: BatchActionKind
  items: BatchOperationItem[]
  source: SourceSelection
  projects: ProjectRecord[]
  agents: AgentDefinition[]
  defaultScope?: 'global' | 'project'
  defaultProjectId?: string
  lockTarget?: boolean
  onRescan?: (paths: string[]) => void
}

const errorMessage = (cause: unknown, fallback: string): string => cause instanceof Error ? cause.message : fallback
const defaultAgentId = 'codex'

const sortAgentsWithDefaultFirst = (left: AgentDefinition, right: AgentDefinition): number => {
  if (left.id === defaultAgentId && right.id !== defaultAgentId) return -1
  if (right.id === defaultAgentId && left.id !== defaultAgentId) return 1
  return left.name.localeCompare(right.name, 'zh-Hans-CN') || left.id.localeCompare(right.id)
}

export const useBatchOperationStore = defineStore('batch-operation', () => {
  const stage = ref<BatchOperationStage>('closed')
  const kind = ref<BatchActionKind>('install')
  const items = ref<BatchOperationItem[]>([])
  const source = ref<SourceSelection>({ kind: 'central' })
  const projects = ref<ProjectRecord[]>([])
  const agents = ref<AgentDefinition[]>([])
  const scope = ref<'global' | 'project'>('global')
  const projectId = ref<string | undefined>()
  const selectedAgents = ref<string[]>([])
  const method = ref<InstallMethod>('symlink')
  const targetLocked = ref(false)
  const planEntries = ref<BatchPlanEntry[]>([])
  const executionEntries = ref<BatchExecutionEntry[]>([])
  const planning = ref(false)
  const error = ref<string | null>(null)
  const current = ref(-1)
  const progress = ref<OperationProgress | null>(null)
  const cancelling = ref(false)
  const sourceLayoutMigration = ref<SourceLayoutMigrationPreview | null>(null)
  let planToken = 0
  let disposeProgress: (() => void) | null = null
  let onRescan: ((paths: string[]) => void) | undefined

  const enabledAgents = computed(() => agents.value.filter((agent) => agent.enabled).sort(sortAgentsWithDefaultFirst))
  const migrationBlocked = computed(() => Boolean(
    sourceLayoutMigration.value?.unresolved.length
    || sourceLayoutMigration.value?.conflicts.length,
  ))
  const canConfirm = computed(() => planEntries.value.length > 0
    && planEntries.value.every((entry) => entry.plan !== null && entry.planningError === null)
    && !migrationBlocked.value
    && error.value === null)
  const operationCount = computed(() => planEntries.value.length)
  const title = computed(() => ({
    install: '批量安装资源', update: '批量更新资源', freeze: '批量冻结资源', thaw: '批量解冻资源', uninstall: '批量卸载资源',
  })[kind.value])
  const targetLabel = computed(() => (
    scope.value === 'global'
      ? '全局'
      : projects.value.find((project) => project.id === projectId.value)?.name ?? projectId.value ?? '项目'
  ))

  const stopProgress = (): void => {
    disposeProgress?.()
    disposeProgress = null
  }

  const agentName = (agentId: string): string => agents.value.find((agent) => agent.id === agentId)?.name ?? agentId

  const defaultSelectedAgents = (): string[] => {
    const preferred = enabledAgents.value.find((agent) => agent.id === defaultAgentId)
    const fallback = enabledAgents.value[0]
    const selected = preferred ?? fallback
    return selected ? [selected.id] : []
  }

  const targetFor = (agentId: string, location: AssetStatusLocation | null): OperationRequest['target'] => {
    if (location) return location.projectId
      ? { scope: 'project', projectId: location.projectId, agentId }
      : { scope: 'global', agentId }
    return scope.value === 'project'
      ? { scope: 'project', projectId: projectId.value, agentId }
      : { scope: 'global', agentId }
  }

  const buildEntries = (): BatchPlanEntry[] => {
    const fallbackAgentId = enabledAgents.value[0]?.id ?? 'unknown-agent'
    if (kind.value === 'install') {
      return items.value.flatMap(({ asset }, itemIndex) => selectedAgents.value.map((agentId, agentIndex) => ({
        key: `${asset.id}:${agentId}:${itemIndex}:${agentIndex}`,
        asset,
        agentId,
        agentName: agentName(agentId),
        request: {
          kind: 'install',
          asset: { source: plainSource(source.value), assetId: asset.id },
          target: targetFor(agentId, null),
          method: method.value,
          overwriteModified: false,
        },
        plan: null,
        planningError: null,
      })))
    }
    return items.value.map(({ asset, location }, index) => {
      const agentId = location?.agentId ?? asset.agentId ?? fallbackAgentId
      return {
        key: `${asset.id}:${agentId}:${index}`,
        asset,
        agentId,
        agentName: agentName(agentId),
        request: {
          kind: kind.value,
          asset: { source: plainSource(source.value), assetId: asset.id },
          target: targetFor(agentId, location),
          method: null,
          overwriteModified: false,
        },
        plan: null,
        planningError: location ? null : '缺少受管安装位置',
      }
    })
  }

  const refreshPlans = async (): Promise<void> => {
    const token = ++planToken
    const entries = buildEntries()
    planEntries.value = entries
    executionEntries.value = []
    error.value = null
    if (!entries.length) return
    planning.value = true
    const settled = await Promise.allSettled(entries.map(async (entry): Promise<OperationPlan | null> => {
      if (entry.planningError) return null
      if (kind.value === 'install') {
        const conflict = await window.xcSkills.operations.inspectSourceConflict?.(entry.request)
        if (conflict) throw new Error(`目标已由${conflict.existing.label}提供，请先单独处理来源冲突`)
      }
      return window.xcSkills.operations.plan(entry.request)
    }))
    if (token !== planToken) return
    planEntries.value = entries.map((entry, index) => {
      if (entry.planningError) return entry
      const result = settled[index]
      if (!result || result.status === 'rejected') return {
        ...entry,
        planningError: result?.status === 'rejected' ? errorMessage(result.reason, '无法生成操作计划') : '无法生成操作计划',
      }
      if (!result.value) return { ...entry, planningError: '无法生成操作计划' }
      return { ...entry, plan: result.value }
    })
    planning.value = false
  }

  const refreshSourceLayoutMigration = async (): Promise<void> => {
    sourceLayoutMigration.value = null
    if (kind.value !== 'install') return
    const preview = window.xcSkills.repositories?.previewSourceLayoutMigration
    if (!preview) return
    try {
      sourceLayoutMigration.value = await preview()
    } catch (cause) {
      error.value = errorMessage(cause, '无法检查资源存储状态')
    }
  }

  const open = async (input: OpenBatchOperation): Promise<void> => {
    stopProgress()
    planToken += 1
    kind.value = input.kind
    items.value = input.items
    source.value = plainSource(input.source)
    projects.value = input.projects
    agents.value = input.agents
    scope.value = input.defaultScope ?? 'global'
    projectId.value = input.defaultProjectId ?? input.projects[0]?.id
    selectedAgents.value = defaultSelectedAgents()
    method.value = 'symlink'
    targetLocked.value = input.lockTarget ?? false
    planEntries.value = []
    executionEntries.value = []
    planning.value = false
    error.value = null
    current.value = -1
    progress.value = null
    cancelling.value = false
    sourceLayoutMigration.value = null
    onRescan = input.onRescan
    stage.value = input.kind === 'install' ? 'configure' : 'preview'
    disposeProgress = window.xcSkills.operations.onProgress((event) => {
      const active = executionEntries.value[current.value]
      if (active?.plan?.id === event.planId) progress.value = event
    })
    await refreshPlans()
    await refreshSourceLayoutMigration()
  }

  const confirmPreview = (): void => {
    if (kind.value === 'install' && stage.value === 'configure') stage.value = 'preview'
  }

  const confirmExecution = (): void => {
    if (stage.value === 'preview' && canConfirm.value) stage.value = 'confirm'
  }

  const executeFromPreview = async (): Promise<void> => {
    if (stage.value !== 'preview' || !canConfirm.value) return
    stage.value = 'confirm'
    await executeAll()
  }

  const executeAll = async (): Promise<void> => {
    if (stage.value !== 'confirm' || !canConfirm.value) return
    executionEntries.value = planEntries.value.map((entry) => ({ ...entry, status: 'pending', result: null, error: null }))
    stage.value = 'executing'
    error.value = null
    current.value = -1
    progress.value = null
    const affectedPaths: string[] = []
    const migration = sourceLayoutMigration.value
    if (migration?.moves.length) {
      try {
        sourceLayoutMigration.value = await window.xcSkills.repositories.executeSourceLayoutMigration(migration.token)
      } catch (cause) {
        error.value = `资源存储升级失败：${errorMessage(cause, '无法恢复旧版资源')}`
        for (const entry of executionEntries.value) entry.status = 'not_run'
        stage.value = 'done'
        return
      }
    }
    for (let index = 0; index < executionEntries.value.length; index += 1) {
      current.value = index
      const entry = executionEntries.value[index]!
      entry.status = 'running'
      try {
        const result = await window.xcSkills.operations.execute(entry.plan!.id)
        entry.result = result
        if (result.status === 'completed') {
          entry.status = 'completed'
          affectedPaths.push(...result.affectedPaths)
          continue
        }
        entry.status = result.status === 'cancelled' ? 'cancelled' : 'failed'
        entry.error = result.status === 'cancelled' ? '操作已取消' : `操作未完成：${result.status}`
      } catch (cause) {
        entry.status = 'failed'
        entry.error = errorMessage(cause, '操作失败')
      }
      break
    }
    for (const entry of executionEntries.value) {
      if (entry.status === 'pending') entry.status = 'not_run'
    }
    stage.value = 'done'
    if (affectedPaths.length) onRescan?.([...new Set(affectedPaths)])
  }

  const cancelActive = async (): Promise<void> => {
    if (stage.value !== 'executing') return
    const active = executionEntries.value[current.value]
    if (!active?.plan || active.status !== 'running') return
    cancelling.value = true
    try {
      await window.xcSkills.operations.cancel(active.plan.id)
    } catch (cause) {
      error.value = errorMessage(cause, '取消操作失败')
    } finally {
      cancelling.value = false
    }
  }

  const close = (): void => {
    if (stage.value === 'executing') return
    planToken += 1
    stopProgress()
    stage.value = 'closed'
    items.value = []
    targetLocked.value = false
    planEntries.value = []
    executionEntries.value = []
    sourceLayoutMigration.value = null
    onRescan = undefined
  }

  if (getCurrentScope()) onScopeDispose(stopProgress)

  return {
    stage, kind, items, source, projects, agents, scope, projectId, selectedAgents, method, targetLocked,
    planEntries, executionEntries, planning, error, current, progress, cancelling, sourceLayoutMigration,
    enabledAgents, migrationBlocked, canConfirm, operationCount, title, targetLabel,
    open, refreshPlans, confirmPreview, confirmExecution, executeFromPreview, executeAll, cancelActive, close,
  }
})
