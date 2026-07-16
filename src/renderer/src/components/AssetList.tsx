import type { AssetRecord } from '../../../shared/ipc.js'
import { StatusBadge } from './StatusBadge'

export function AssetList({ assets, selectedId, onSelect, loading, error, query, groupFilter, statusFilter, agentFilter }: { assets: AssetRecord[]; selectedId: string | null; onSelect: (id: string) => void; loading: boolean; error: string | null; query: string; groupFilter: string; statusFilter: string; agentFilter: string }) {
  const filtered = assets.filter((asset) => asset.name.toLowerCase().includes(query.toLowerCase()) || asset.description.toLowerCase().includes(query.toLowerCase()))
    .filter((asset) => groupFilter === 'all' || asset.group === groupFilter)
    .filter((asset) => statusFilter === 'all' || asset.entryState === statusFilter)
    .filter((asset) => agentFilter === 'all' || (asset as AssetRecord & { agentId?: string }).agentId === agentFilter)
  if (loading) return <div className="asset-state" role="status">正在加载资源…</div>
  if (error) return <div className="asset-state error" role="alert">{error}</div>
  if (!filtered.length) return <div className="asset-state">没有匹配的资源</div>
  return <div className="asset-list" role="list" aria-label="资源列表">{filtered.map((asset) => <button role="listitem" className={asset.id === selectedId ? 'asset-row selected' : 'asset-row'} key={asset.id} onClick={() => onSelect(asset.id)}>
    <span className="asset-copy"><strong>{asset.name}</strong><small>{asset.group} · {asset.description}</small></span><StatusBadge status={asset.entryState} />
  </button>)}</div>
}
