import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  AgentDefinition, AssetRecord, InstallMethod, OperationKind, OperationPlan, OperationProgress,
  OperationRequest, OperationResult, ProjectRecord, SourceSelection,
  SourceConflict,
} from '../../../shared/ipc.js'
import { plainSource } from '../app/types'

export type OperationStage = 'closed' | 'preview' | 'confirm' | 'executing' | 'done'
export type OperationLocation = { projectId: string | null; agentId: string; path: string }
export type OpenOperation = {
  kind: OperationKind
  asset: AssetRecord
  source: SourceSelection
  projects: ProjectRecord[]
  agents: AgentDefinition[]
  location?: OperationLocation
  allowSymlink?: boolean
  scope?: 'global' | 'project'
  projectId?: string
  onRescan?: (paths: string[]) => void
}

const joinPath = (...parts: string[]): string => parts.filter(Boolean).join('/').replaceAll(/\/{2,}/g, '/')

export const useOperationStore = defineStore('operation', () => {
  const stage = ref<OperationStage>('closed')
  const kind = ref<OperationKind>('install')
  const asset = ref<AssetRecord | null>(null)
  const source = ref<SourceSelection>({ kind: 'central' })
  const projects = ref<ProjectRecord[]>([])
  const agents = ref<AgentDefinition[]>([])
  const location = ref<OperationLocation | null>(null)
  const allowSymlink = ref(true)
  const scope = ref<'global' | 'project'>('global')
  const projectId = ref<string | undefined>()
  const selectedAgents = ref<string[]>([])
  const method = ref<InstallMethod>('copy')
  const plans = ref<OperationPlan[]>([])
  const error = ref<string | null>(null)
  const current = ref(0)
  const progress = ref<OperationProgress | null>(null)
  const result = ref<OperationResult | null>(null)
  const sourceConflict = ref<SourceConflict | null>(null)
  const replaceExistingSource = ref(false)
  const cancelling = ref(false)
  let planToken = 0
  let disposeProgress: (() => void) | null = null
  let onRescan: ((paths: string[]) => void) | undefined

  const enabledAgents = computed(() => agents.value.filter((agent) => agent.enabled))
  const allSteps = computed(() => plans.value.flatMap((entry) => entry.steps))
  const warnings = computed(() => plans.value.flatMap((entry) => entry.warnings))
  const hasOverwrite = computed(() => plans.value.some((entry) => entry.requiresOverwriteConfirmation))
  const title = computed(() => ({ install: '安装资源', update: '更新资源', uninstall: '卸载资源', freeze: '冻结资源', thaw: '解冻资源' })[kind.value])
  const targetLabel = computed(() => scope.value === 'global' ? '全局' : projects.value.find((project) => project.id === projectId.value)?.name ?? projectId.value ?? '项目')
  const affectedPaths = computed(() => {
    const planned = allSteps.value.map((step) => step.target)
    if (planned.length) return [...new Set(planned)]
    if (!asset.value) return []
    return selectedAgents.value.map((agentId) => {
      const agent = enabledAgents.value.find((entry) => entry.id === agentId)
      if (!agent) return asset.value!.name
      const selectedProject = projects.value.find((entry) => entry.id === projectId.value)
      const rawBase = scope.value === 'project' ? agent.projectBaseDir : agent.globalBaseDir
      const base = scope.value === 'project' && !rawBase.startsWith('/') ? joinPath(selectedProject?.path ?? '', rawBase) : rawBase
      const rawAssetDir = agent.assetDirs[asset.value!.type]
      const root = rawAssetDir.startsWith('/') ? rawAssetDir : joinPath(base, rawAssetDir)
      return joinPath(root, asset.value!.name)
    })
  })

  const stopProgress = (): void => {
    disposeProgress?.()
    disposeProgress = null
  }

  const refreshPlans = async (): Promise<void> => {
    const token = ++planToken
    const selectedAsset = asset.value
    if (!selectedAsset || !selectedAgents.value.length) { plans.value = []; return }
    error.value = null
    const targets = selectedAgents.value.map((agentId): OperationRequest['target'] => {
      if (location.value) return location.value.projectId
        ? { scope: 'project', projectId: location.value.projectId, agentId }
        : { scope: 'global', agentId }
      return scope.value === 'project'
        ? { scope: 'project', projectId: projectId.value, agentId }
        : { scope: 'global', agentId }
    })
    try {
      const requests = targets.map((target): OperationRequest => ({
        kind: kind.value,
        asset: { source: plainSource(source.value), assetId: selectedAsset.id },
        target,
        method: kind.value === 'install' ? method.value : null,
        overwriteModified: false,
        ...(replaceExistingSource.value ? { replaceExistingSource: true } : {}),
      }))
      const inspect = window.xcSkills.operations.inspectSourceConflict
      const conflicts = kind.value === 'install' || kind.value === 'update'
        ? await Promise.all(requests.map((request) => inspect ? inspect(request) : null))
        : []
      const conflict = conflicts.find((entry): entry is SourceConflict => entry !== null) ?? null
      sourceConflict.value = conflict
      if (conflict && !replaceExistingSource.value) {
        if (token === planToken) plans.value = []
        return
      }
      const nextPlans = await Promise.all(requests.map((request) => window.xcSkills.operations.plan(request)))
      if (token === planToken) plans.value = nextPlans
    } catch (cause) {
      if (token !== planToken) return
      plans.value = []
      error.value = cause instanceof Error ? cause.message : '无法生成操作计划'
    }
  }

  const open = async (input: OpenOperation): Promise<void> => {
    stopProgress()
    planToken += 1
    kind.value = input.kind
    asset.value = input.asset
    source.value = input.source
    projects.value = input.projects
    agents.value = input.agents
    location.value = input.location ?? null
    allowSymlink.value = input.allowSymlink ?? true
    const defaultScope = input.kind === 'install' && input.projects.length ? 'project' : 'global'
    scope.value = input.location ? (input.location.projectId ? 'project' : 'global') : (input.scope ?? defaultScope)
    projectId.value = input.location?.projectId ?? input.projectId ?? input.projects[0]?.id
    selectedAgents.value = input.location ? [input.location.agentId] : input.agents.filter((agent) => agent.enabled).map((agent) => agent.id)
    method.value = 'copy'
    plans.value = []
    error.value = null
    current.value = 0
    progress.value = null
    result.value = null
    sourceConflict.value = null
    replaceExistingSource.value = false
    cancelling.value = false
    onRescan = input.onRescan
    stage.value = 'preview'
    disposeProgress = window.xcSkills.operations.onProgress((event) => {
      const active = plans.value[current.value]
      if (!active || event.planId === active.id) progress.value = event
    })
    await refreshPlans()
  }

  const confirm = (): void => { if (stage.value === 'preview' && plans.value.length) stage.value = 'confirm' }
  const confirmSourceReplacement = async (): Promise<void> => {
    replaceExistingSource.value = true
    await refreshPlans()
  }

  const executeAll = async (): Promise<void> => {
    if (stage.value !== 'confirm' || !plans.value.length) return
    stage.value = 'executing'
    error.value = null
    progress.value = null
    let last: OperationResult | null = null
    try {
      for (let index = 0; index < plans.value.length; index += 1) {
        current.value = index
        last = await window.xcSkills.operations.execute(plans.value[index]!.id)
        if (last.status === 'completed') onRescan?.(last.affectedPaths)
        if (last.status !== 'completed') break
      }
      result.value = last
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '操作失败'
    } finally {
      stage.value = 'done'
    }
  }

  const cancelActive = async (): Promise<void> => {
    const active = plans.value[current.value]
    if (!active) return
    cancelling.value = true
    try { await window.xcSkills.operations.cancel(active.id) } finally { cancelling.value = false }
  }

  const close = (): void => {
    planToken += 1
    stopProgress()
    stage.value = 'closed'
    asset.value = null
    plans.value = []
    onRescan = undefined
  }

  onScopeDispose(stopProgress)

  return {
    stage, kind, asset, source, projects, agents, location, allowSymlink, scope, projectId, selectedAgents, method,
    plans, error, current, progress, result, cancelling, sourceConflict, replaceExistingSource,
    enabledAgents, allSteps, warnings, hasOverwrite, title, targetLabel, affectedPaths,
    open, refreshPlans, confirmSourceReplacement, confirm, executeAll, cancelActive, close,
  }
})
