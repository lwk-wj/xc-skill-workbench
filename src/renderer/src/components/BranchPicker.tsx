import { useEffect, useRef, useState } from 'react'
import type { RepositoryBranch } from '../../../shared/ipc.js'

export function BranchPicker({ branches, selected, onSelect, onSetDefault }: { branches: RepositoryBranch[]; selected: string | null; onSelect: (branch: string) => void; onSetDefault: (branch: string) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLDivElement | null>>([])
  const current = selected ?? branches.find((branch) => branch.current)?.name ?? 'main'
  useEffect(() => {
    if (!open) return

    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return <div className="branch-picker" ref={rootRef}>
    <button className="branch-button" aria-label="选择分支" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}>分支：<span className="branch-value">{current}</span><span className="select-chevron" aria-hidden="true">⌄</span></button>
    {open && <div className="branch-menu" role="listbox" aria-label="选择分支">
      {branches.map((branch, index) => <div ref={(element) => { optionRefs.current[index] = element }} className="branch-option" role="option" tabIndex={0} aria-label={branch.name} aria-selected={branch.name === current} key={branch.name} onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(branch.name); setOpen(false); return }
        const target = event.key === 'ArrowDown' ? Math.min(index + 1, branches.length - 1) : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? branches.length - 1 : -1
        if (target >= 0) { event.preventDefault(); optionRefs.current[target]?.focus() }
      }} onClick={() => { onSelect(branch.name); setOpen(false) }}>
        <button onClick={() => { onSelect(branch.name); setOpen(false) }}>{branch.name}{branch.default ? ' · 默认' : ''}</button>
        {!branch.default && <button className="default-branch" onClick={(event) => { event.stopPropagation(); onSetDefault(branch.name) }}>设为默认</button>}
      </div>)}
    </div>}
  </div>
}
