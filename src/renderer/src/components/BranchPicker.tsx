import { useState } from 'react'
import type { RepositoryBranch } from '../../../shared/ipc.js'

export function BranchPicker({ branches, selected, onSelect, onSetDefault }: { branches: RepositoryBranch[]; selected: string | null; onSelect: (branch: string) => void; onSetDefault: (branch: string) => void }) {
  const [open, setOpen] = useState(false)
  const current = selected ?? branches.find((branch) => branch.current)?.name ?? 'main'
  return <div className="branch-picker">
    <button className="branch-button" aria-label="选择分支" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}>分支：{current}⌄</button>
    {open && <div className="branch-menu" role="listbox" aria-label="选择分支">
      {branches.map((branch) => <div className="branch-option" role="option" tabIndex={0} aria-label={branch.name} aria-selected={branch.name === current} key={branch.name} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(branch.name); setOpen(false) } }} onClick={() => { onSelect(branch.name); setOpen(false) }}>
        <button onClick={() => { onSelect(branch.name); setOpen(false) }}>{branch.name}{branch.default ? ' · 默认' : ''}</button>
        {!branch.default && <button className="default-branch" onClick={(event) => { event.stopPropagation(); onSetDefault(branch.name) }}>设为默认</button>}
      </div>)}
    </div>}
  </div>
}
