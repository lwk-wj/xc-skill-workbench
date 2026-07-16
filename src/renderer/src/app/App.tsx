import { useEffect, useMemo, useState } from 'react'
import { useExplorerStore } from './store'
import { AssetList } from '../components/AssetList'
import { BranchPicker } from '../components/BranchPicker'
import { SourceSidebar } from '../components/SourceSidebar'
import { AssetDetail } from '../components/AssetDetail'
import { OperationDialog } from '../features/operations/OperationDialog'
import type { OperationKind } from '../../../shared/ipc.js'

type OperationLocation = { projectId: string | null; agentId: string; path: string }
import '../styles/tokens.css'
import '../styles/app.css'

const tabs = [{ value: 'skills', label: 'Skills' }, { value: 'rules', label: 'Rules' }, { value: 'workflows', label: 'Workflows' }] as const

export function App() {
  const state = useExplorerStore()
  const [operation, setOperation] = useState<{ kind: OperationKind; location: OperationLocation } | null>(null)
  useEffect(() => { void state.initialize() }, [])
  const groups = useMemo(() => ['all', ...new Set(state.assets.map((asset) => asset.group))], [state.assets])
  const selectedAsset = state.assets.find((asset) => asset.id === state.selectedAssetId)
  const visibleAssets = state.assets.filter((asset) => asset.type === state.assetType)
  return <main className="app-shell" data-testid="app-shell">
    <SourceSidebar sources={state.sources} selected={state.selectedSource} onSelect={(source) => void state.selectSource(source)} onAdd={() => void state.addProject()} onRemove={(id) => void state.removeProject(id)} />
    <section className="explorer-pane" aria-label="资源浏览器">
      <header className="explorer-header">
        <div className="title-row"><div><h1>{state.selectedSource.label}</h1><p className="subtitle">浏览与管理资源</p></div>{state.selectedSource.kind === 'central' && <BranchPicker branches={state.branches} selected={state.selectedBranch} onSelect={(branch) => void state.selectBranch(branch)} onSetDefault={(branch) => void state.setDefaultBranch(branch)} />}</div>
        {state.stale && <div className="stale-banner">缓存数据 · {state.cachedAt ?? '时间未知'}</div>}
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="资源类型">{tabs.map((tab) => <button role="tab" aria-selected={state.assetType === tab.value} key={tab.value} onClick={() => state.setAssetType(tab.value)}>{tab.label}</button>)}</div>
          <label className="search"><span className="sr-only">搜索资源</span><input aria-label="搜索资源" role="searchbox" placeholder="搜索资源" value={state.query} onChange={(event) => state.setQuery(event.target.value)} /></label>
        </div>
        <div className="filters">
          <label>分组<select aria-label="分组筛选" value={state.groupFilter} onChange={(event) => state.setGroupFilter(event.target.value)}>{groups.map((group) => <option key={group} value={group}>{group === 'all' ? '全部分组' : group}</option>)}</select></label>
          <label>状态<select aria-label="状态筛选" value={state.statusFilter} onChange={(event) => state.setStatusFilter(event.target.value)}><option value="all">全部状态</option><option value="active">正常</option><option value="frozen">已冻结</option><option value="conflict">冲突</option><option value="invalid">无效</option></select></label>
          <label>Agent<select aria-label="Agent筛选" value={state.agentFilter} onChange={(event) => state.setAgentFilter(event.target.value)}><option value="all">全部 Agent</option>{state.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        </div>
      </header>
      <AssetList assets={visibleAssets} selectedId={state.selectedAssetId} onSelect={state.selectAsset} loading={state.loading} error={state.error} query={state.query} groupFilter={state.groupFilter} statusFilter={state.statusFilter} agentFilter={state.agentFilter} />
    </section>
    <aside className="detail-pane" aria-label="资源详情">{selectedAsset ? <AssetDetail asset={selectedAsset} source={state.selectedSource} onAction={(kind, location) => { if (kind !== 'diagnose') setOperation({ kind: kind === 'update-with-warning' ? 'update' : kind as OperationKind, location }) }} /> : <div className="detail-empty">选择资源查看详情</div>}</aside>
    {selectedAsset && operation && <OperationDialog open kind={operation.kind} asset={selectedAsset} projects={state.projects} agents={state.agents} location={operation.location} source={operation.location.projectId ? { kind: 'project', projectId: operation.location.projectId } : { kind: 'global' }} onClose={() => setOperation(null)} onRescan={() => void state.selectSource(state.selectedSource)} plan={window.xcSkills.operations.plan} execute={window.xcSkills.operations.execute} cancel={window.xcSkills.operations.cancel} progressEvents={window.xcSkills.operations.onProgress} />}
  </main>
}
