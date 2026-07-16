import { create } from 'zustand'
import type { AgentDefinition, AssetRecord, RepositoryBranch, SourceSelection } from '../../../shared/ipc.js'

export type AssetType = 'skills' | 'rules' | 'workflows'
export type ExplorerSource = SourceSelection & { id: string; label: string; path?: string }

export interface ExplorerState {
  sources: ExplorerSource[]
  selectedSource: ExplorerSource
  assetType: AssetType
  query: string
  groupFilter: string
  statusFilter: string
  agentFilter: string
  assets: AssetRecord[]
  selectedAssetId: string | null
  branches: RepositoryBranch[]
  selectedBranch: string | null
  loading: boolean
  error: string | null
  stale: boolean
  cachedAt: string | null
  projects: Array<{ id: string; name: string; path: string }>
  agents: AgentDefinition[]
  initialize: () => Promise<void>
  selectSource: (source: ExplorerSource) => Promise<void>
  setAssetType: (type: AssetType) => void
  setQuery: (query: string) => void
  setGroupFilter: (value: string) => void
  setStatusFilter: (value: string) => void
  setAgentFilter: (value: string) => void
  selectAsset: (id: string | null) => void
  selectBranch: (branch: string) => Promise<void>
  setDefaultBranch: (branch: string) => Promise<void>
  addProject: () => Promise<void>
  removeProject: (id: string) => Promise<void>
}

const central: ExplorerSource = { id: 'central', kind: 'central', label: '中央仓库' }
const globalSource: ExplorerSource = { id: 'global', kind: 'global', label: '全局安装' }
let requestId = 0

function sourceFromSelection(selection: SourceSelection, projects: ExplorerState['projects']): ExplorerSource {
  if (selection.kind === 'central') return central
  if (selection.kind === 'global') return globalSource
  const project = projects.find((item) => item.id === selection.projectId)
  if (!project) return central
  return { ...selection, id: `project:${selection.projectId}`, label: project?.name ?? selection.projectId, path: project?.path }
}

async function scanSource(source: ExplorerSource, set: (value: Partial<ExplorerState>) => void, get: () => ExplorerState) {
  const id = ++requestId
  const priorSelected = get().selectedAssetId
  set({ loading: true, error: null })
  try {
    const assets = await window.xcSkills.assets.scan(source)
    if (id !== requestId) return
    set({ assets, loading: false, selectedAssetId: priorSelected && assets.some((asset) => asset.id === priorSelected) ? priorSelected : null })
  } catch (error) {
    if (id !== requestId) return
    set({ loading: false, error: error instanceof Error ? error.message : '加载资源失败', assets: [], selectedAssetId: null })
  }
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  sources: [central, globalSource],
  selectedSource: central,
  assetType: 'skills',
  query: '',
  groupFilter: 'all',
  statusFilter: 'all',
  agentFilter: 'all',
  assets: [],
  selectedAssetId: null,
  branches: [],
  selectedBranch: null,
  loading: false,
  error: null,
  stale: false,
  cachedAt: null,
  projects: [],
  agents: [],
  initialize: async () => {
    try {
      const [projects, agents, lastSource] = await Promise.all([
        window.xcSkills.projects.list(),
        window.xcSkills.agents.list(),
        window.xcSkills.preferences.getLastSource(),
      ])
      const sourceList = [central, globalSource, ...projects.map((project) => ({ kind: 'project' as const, projectId: project.id, id: `project:${project.id}`, label: project.name, path: project.path }))]
      const selectedSource = sourceFromSelection(lastSource, projects)
      set({ projects, agents, sources: sourceList, selectedSource })
      await scanSource(selectedSource, set, get)
      if (selectedSource.kind === 'central') {
        const branches = await window.xcSkills.repositories.listBranches()
        set({ branches, selectedBranch: branches.find((item) => item.current)?.name ?? null })
      }
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '初始化失败' })
    }
  },
  selectSource: async (source) => {
    set({ selectedSource: source, query: '', groupFilter: 'all', statusFilter: 'all', agentFilter: 'all', stale: false, cachedAt: null })
    await scanSource(source, set, get)
    if (source.kind === 'central') {
      try {
        const branches = await window.xcSkills.repositories.listBranches()
        set({ branches, selectedBranch: branches.find((item) => item.current)?.name ?? null })
      } catch (error) {
        set({ error: error instanceof Error ? error.message : '加载分支失败' })
      }
    }
  },
  setAssetType: (assetType) => set({ assetType, selectedAssetId: null }),
  setQuery: (query) => set({ query }),
  setGroupFilter: (groupFilter) => set({ groupFilter }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setAgentFilter: (agentFilter) => set({ agentFilter }),
  selectAsset: (selectedAssetId) => set({ selectedAssetId }),
  selectBranch: async (branch) => {
    const source = get().selectedSource
    if (source.kind !== 'central') return
    set({ loading: true, error: null })
    try {
      const view = await window.xcSkills.repositories.selectBranch(branch)
      set({ selectedBranch: branch, stale: view.stale, cachedAt: view.cachedAt, loading: false })
      await scanSource(source, set, get)
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '切换分支失败' })
    }
  },
  setDefaultBranch: async (branch) => {
    if (window.confirm && !window.confirm(`将 ${branch} 设为默认分支？`)) return
    try { await window.xcSkills.repositories.setDefaultBranch(branch) } catch (error) { set({ error: error instanceof Error ? error.message : '设置默认分支失败' }) }
  },
  addProject: async () => {
    try {
      const project = await window.xcSkills.projects.chooseAndAdd()
      if (!project) return
      const projects = [...get().projects.filter((item) => item.id !== project.id), project]
      const sourceList = [central, globalSource, ...projects.map((item) => ({ kind: 'project' as const, projectId: item.id, id: `project:${item.id}`, label: item.name, path: item.path }))]
      set({ projects, sources: sourceList })
    } catch (error) { set({ error: error instanceof Error ? error.message : '添加项目失败' }) }
  },
  removeProject: async (id) => {
    try {
      await window.xcSkills.projects.remove(id)
      const projects = get().projects.filter((project) => project.id !== id)
      const sources = [central, globalSource, ...projects.map((item) => ({ kind: 'project' as const, projectId: item.id, id: `project:${item.id}`, label: item.name, path: item.path }))]
      const current = get().selectedSource
      const selectedSource = current.kind === 'project' && current.projectId === id ? central : current
      set({ projects, sources, selectedSource })
      if (get().selectedSource.id === 'central' && selectedSource.id === 'central') await scanSource(central, set, get)
    } catch (error) { set({ error: error instanceof Error ? error.message : '移除项目失败' }) }
  },
}))
