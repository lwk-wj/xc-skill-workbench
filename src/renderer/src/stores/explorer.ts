import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { AgentDefinition, AssetRecord, ProjectRecord, RepositoryBranch, SourceSelection } from '../../../shared/ipc.js'
import { plainSource, type AssetType, type ExplorerSource } from '../app/types'

const central: ExplorerSource = { id: 'central', kind: 'central', label: '中央仓库' }
const globalSource: ExplorerSource = { id: 'global', kind: 'global', label: '全局安装' }

const projectSource = (project: ProjectRecord): ExplorerSource => ({
  kind: 'project', projectId: project.id, id: `project:${project.id}`, label: project.name, path: project.path,
})

const sourceFromSelection = (selection: SourceSelection, projects: ProjectRecord[]): ExplorerSource => {
  if (selection.kind === 'central') return central
  if (selection.kind === 'global') return globalSource
  const project = projects.find((entry) => entry.id === selection.projectId)
  return project ? projectSource(project) : central
}

export const useExplorerStore = defineStore('explorer', () => {
  const sources = ref<ExplorerSource[]>([central, globalSource])
  const selectedSource = ref<ExplorerSource>(central)
  const assetType = ref<AssetType>('skills')
  const query = ref('')
  const groupFilter = ref('all')
  const statusFilter = ref('all')
  const agentFilter = ref('all')
  const assets = ref<AssetRecord[]>([])
  const selectedAssetId = ref<string | null>(null)
  const branches = ref<RepositoryBranch[]>([])
  const selectedBranch = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const stale = ref(false)
  const cachedAt = ref<string | null>(null)
  const projects = ref<ProjectRecord[]>([])
  const agents = ref<AgentDefinition[]>([])
  let requestId = 0

  const groups = computed(() => ['all', ...new Set(assets.value.map((asset) => asset.group))])
  const selectedAsset = computed(() => assets.value.find((asset) => asset.id === selectedAssetId.value) ?? null)
  const visibleAssets = computed(() => assets.value.filter((asset) => asset.type === assetType.value))
  const agentMap = computed(() => new Map(agents.value.map((agent) => [agent.id, agent.name])))
  const agentName = (agentId?: string): string => agentId ? agentMap.value.get(agentId) ?? agentId : ''

  const scan = async (source: ExplorerSource): Promise<void> => {
    const id = ++requestId
    const priorSelected = selectedAssetId.value
    loading.value = true
    error.value = null
    try {
      const nextAssets = await window.xcSkills.assets.scan(plainSource(source))
      if (id !== requestId) return
      assets.value = nextAssets
      selectedAssetId.value = priorSelected && nextAssets.some((asset) => asset.id === priorSelected) ? priorSelected : null
    } catch (cause) {
      if (id !== requestId) return
      assets.value = []
      selectedAssetId.value = null
      error.value = cause instanceof Error ? cause.message : '加载资源失败'
    } finally {
      if (id === requestId) loading.value = false
    }
  }

  const loadBranches = async (): Promise<void> => {
    branches.value = await window.xcSkills.repositories.listBranches()
    selectedBranch.value = branches.value.find((branch) => branch.current)?.name ?? null
  }

  const initialize = async (): Promise<void> => {
    try {
      const [nextProjects, nextAgents, lastSource] = await Promise.all([
        window.xcSkills.projects.list(),
        window.xcSkills.agents.list(),
        window.xcSkills.preferences.getLastSource(),
      ])
      projects.value = nextProjects
      agents.value = nextAgents
      sources.value = [central, globalSource, ...nextProjects.map(projectSource)]
      selectedSource.value = sourceFromSelection(lastSource, nextProjects)
      await scan(selectedSource.value)
      if (selectedSource.value.kind === 'central') await loadBranches()
    } catch (cause) {
      loading.value = false
      error.value = cause instanceof Error ? cause.message : '初始化失败'
    }
  }

  const selectSource = async (source: ExplorerSource): Promise<void> => {
    selectedAssetId.value = null
    selectedSource.value = source
    query.value = ''
    groupFilter.value = 'all'
    statusFilter.value = 'all'
    agentFilter.value = 'all'
    stale.value = false
    cachedAt.value = null
    await scan(source)
    if (source.kind === 'central') {
      try { await loadBranches() } catch (cause) { error.value = cause instanceof Error ? cause.message : '加载分支失败' }
    }
  }

  const selectBranch = async (branch: string): Promise<void> => {
    if (selectedSource.value.kind !== 'central') return
    loading.value = true
    error.value = null
    try {
      const view = await window.xcSkills.repositories.selectBranch(branch)
      selectedBranch.value = branch
      stale.value = view.stale
      cachedAt.value = view.cachedAt
      await scan(selectedSource.value)
    } catch (cause) {
      loading.value = false
      error.value = cause instanceof Error ? cause.message : '切换分支失败'
    }
  }

  const setDefaultBranch = async (branch: string): Promise<void> => {
    if (window.confirm && !window.confirm(`将 ${branch} 设为默认分支？`)) return
    try { await window.xcSkills.repositories.setDefaultBranch(branch) } catch (cause) { error.value = cause instanceof Error ? cause.message : '设置默认分支失败' }
  }

  const addProject = async (): Promise<void> => {
    try {
      const project = await window.xcSkills.projects.chooseAndAdd()
      if (!project) return
      projects.value = [...projects.value.filter((entry) => entry.id !== project.id), project]
      sources.value = [central, globalSource, ...projects.value.map(projectSource)]
    } catch (cause) { error.value = cause instanceof Error ? cause.message : '添加项目失败' }
  }

  const removeProject = async (id: string): Promise<void> => {
    try {
      await window.xcSkills.projects.remove(id)
      projects.value = projects.value.filter((project) => project.id !== id)
      sources.value = [central, globalSource, ...projects.value.map(projectSource)]
      if (selectedSource.value.kind === 'project' && selectedSource.value.projectId === id) {
        selectedAssetId.value = null
        selectedSource.value = central
        await scan(central)
      }
    } catch (cause) { error.value = cause instanceof Error ? cause.message : '移除项目失败' }
  }

  const refreshAgents = async (): Promise<void> => { agents.value = await window.xcSkills.agents.list() }
  const refreshCurrentSource = async (): Promise<void> => scan(selectedSource.value)
  const refreshRepository = async (): Promise<void> => {
    try {
      await loadBranches()
      if (selectedSource.value.kind === 'central') await scan(selectedSource.value)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '刷新中央仓库失败'
    }
  }

  return {
    sources, selectedSource, assetType, query, groupFilter, statusFilter, agentFilter, assets, selectedAssetId,
    branches, selectedBranch, loading, error, stale, cachedAt, projects, agents,
    groups, selectedAsset, visibleAssets, agentName,
    initialize, selectSource, selectBranch, setDefaultBranch, addProject, removeProject,
    refreshAgents, refreshCurrentSource, refreshRepository,
  }
})
