import { useEffect, useId, useRef, useState } from 'react'

type FilterOption = {
  value: string
  label: string
}

export function FilterSelect({ label, value, options, onChange }: {
  label: string
  value: string
  options: FilterOption[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const menuId = useId()
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const selected = options[selectedIndex]

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

  const openAndFocus = (index = selectedIndex) => {
    setOpen(true)
    requestAnimationFrame(() => optionRefs.current[index]?.focus())
  }

  return <div className="filter-control">
    <span className="filter-label">{label}</span>
    <div className="filter-select" ref={rootRef}>
      <button
        type="button"
        className="filter-select-button"
        role="combobox"
        aria-label={`${label}筛选`}
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); openAndFocus() }
          if (event.key === 'ArrowUp') { event.preventDefault(); openAndFocus(options.length - 1) }
          if (event.key === 'Escape') setOpen(false)
        }}
      >
        <span>{selected?.label ?? value}</span>
        <span className="select-chevron" aria-hidden="true">⌄</span>
      </button>
      {open && <div id={menuId} className="filter-select-menu" role="listbox" aria-label={`${label}筛选选项`}>
        {options.map((option, index) => <button
          type="button"
          role="option"
          aria-selected={option.value === value}
          className="filter-select-option"
          ref={(element) => { optionRefs.current[index] = element }}
          key={option.value}
          onClick={() => { onChange(option.value); setOpen(false) }}
          onKeyDown={(event) => {
            const target = event.key === 'ArrowDown'
              ? Math.min(index + 1, options.length - 1)
              : event.key === 'ArrowUp'
                ? Math.max(index - 1, 0)
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? options.length - 1
                    : -1
            if (target >= 0) { event.preventDefault(); optionRefs.current[target]?.focus() }
          }}
        >
          <span className="filter-option-check" aria-hidden="true">{option.value === value ? '✓' : ''}</span>
          <span>{option.label}</span>
        </button>)}
      </div>}
    </div>
  </div>
}
