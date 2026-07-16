import type { ExplorerSource } from '../app/store'

export function SourceSidebar({ sources, selected, onSelect, onAdd, onRemove, onSettings }: { sources: ExplorerSource[]; selected: ExplorerSource; onSelect: (source: ExplorerSource) => void; onAdd: () => void; onRemove: (id: string) => void; onSettings?: () => void }) {
  return <aside className="source-sidebar" aria-label="资源来源">
    <div className="brand">XC Skills</div>
    <nav aria-label="来源导航">
      {sources.map((source) => <div className="source-row" key={source.id}>
        <button className={selected.id === source.id ? 'source-button selected' : 'source-button'} onClick={() => onSelect(source)}>{source.label}</button>
        {source.kind === 'project' && <button className="icon-button" aria-label={`移除项目 ${source.label}`} onClick={() => onRemove(source.projectId)}>×</button>}
      </div>)}
    </nav>
    <div className="sidebar-footer">
      <button className="add-project" aria-label="添加项目" onClick={onAdd}>＋ 添加项目</button>
      <button className="settings-button" onClick={() => onSettings?.()}>⚙ 设置</button>
    </div>
  </aside>
}
