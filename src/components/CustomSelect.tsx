import { useEffect, useMemo, useRef, useState } from 'react'

export interface SelectOption<T extends string> {
  label: string
  group?: string
  value: T
}

interface CustomSelectProps<T extends string> {
  menuTheme?: 'light' | 'dark'
  options: Array<SelectOption<T>>
  searchPlaceholder?: string
  searchable?: boolean
  value: T
  onChange: (value: T) => void
}

export function CustomSelect<T extends string>({
  menuTheme = 'light',
  options,
  searchPlaceholder = 'Buscar...',
  searchable = false,
  value,
  onChange,
}: CustomSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value],
  )

  const visibleOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) return options

    return options.filter((option) => option.label.toLowerCase().includes(normalizedQuery))
  }, [options, query])

  const visibleGroups = useMemo(() => {
    const order = new Map<string, SelectOption<T>[]>()

    visibleOptions.forEach((option) => {
      const key = option.group ?? ''
      const bucket = order.get(key)
      if (bucket) {
        bucket.push(option)
      } else {
        order.set(key, [option])
      }
    })

    return [...order.entries()].map(([label, groupOptions]) => ({
      label,
      options: groupOptions,
    }))
  }, [visibleOptions])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [])

  useEffect(() => {
    if (open && searchable) {
      searchRef.current?.focus()
    }
  }, [open, searchable])

  return (
    <div ref={rootRef} className={`custom-select ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="custom-select-trigger"
        aria-expanded={open}
        onClick={() =>
          setOpen((current) => {
            if (current) {
              setQuery('')
            }
            return !current
          })
        }
      >
        <span>{selected?.label ?? ''}</span>
        <span className="custom-select-arrow" aria-hidden="true" />
      </button>

      {open && (
        <div className={`custom-select-menu ${menuTheme === 'dark' ? 'dark' : 'light'}`}>
          {searchable && (
            <div className="custom-select-search">
              <input
                ref={searchRef}
                type="text"
                value={query}
                placeholder={searchPlaceholder}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          )}

          <div className="custom-select-list">
            {visibleGroups.map((group) => (
              <div key={group.label || 'default'} className="custom-select-group">
                {group.label ? <div className="custom-select-group-label">{group.label}</div> : null}
                {group.options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`custom-select-option ${option.value === value ? 'selected' : ''}`}
                    onClick={() => {
                      onChange(option.value)
                      setOpen(false)
                      setQuery('')
                    }}
                  >
                    <span>{option.label}</span>
                    {option.value === value && <span className="custom-select-check" aria-hidden="true" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
