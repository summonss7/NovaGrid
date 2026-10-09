import { X } from 'lucide-react'
import { useState } from 'react'
import { useStore } from 'zustand'
import { colName } from '../grid/geometry'
import { gridStore } from '../core/store'
import { dict, useT } from '../i18n'
import { ColumnMenu } from './ColumnMenu'

/** Подпись чипа: главное значение + счётчик остальных. */
function chipLabel(col: number, mode: 'include' | 'exclude', values: string[]): string {
  const letter = colName(col)
  const sign = mode === 'include' ? '=' : '≠'
  const d = dict()
  const first = values[0] === '' ? d.filterBlanks : values[0]
  const more = values.length > 1 ? ` ${d.filterChipMore(values.length - 1)}` : ''
  return `${letter} ${sign} ${first}${more}`
}

/**
 * Лента чипов активных фильтров (CONCEPT Ф3.4, DESIGN-SYSTEM §6): строка под
 * тулбаром — [A: Иванов ×] [C: 10000 ×] … [Сбросить всё]. Крестик снимает
 * один фильтр, клик по чипу открывает меню колонки (редактирование списка).
 */
export function FilterBar() {
  const t = useT()
  const filters = useStore(gridStore, (s) => s.filters)
  const [menu, setMenu] = useState<{ col: number; x: number; y: number } | null>(null)

  if (filters.length === 0) return null

  return (
    <div className="filter-bar" role="group" aria-label={t.filterBarLabel}>
      <span className="filter-bar-label">{t.filterBarLabel}</span>
      {filters.map((f) => (
        <span key={f.col} className="filter-chip">
          <button
            type="button"
            className="filter-chip-text"
            title={t.columnMenuLabel(colName(f.col))}
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setMenu({ col: f.col, x: r.left, y: r.bottom + 4 })
            }}
          >
            {chipLabel(f.col, f.mode, f.values)}
          </button>
          <button
            type="button"
            className="filter-chip-x"
            aria-label={t.ctxClearColumn(colName(f.col))}
            title={t.ctxClearColumn(colName(f.col))}
            onClick={() => gridStore.getState().clearColumnFilter(f.col)}
          >
            <X size={12} strokeWidth={2} aria-hidden />
          </button>
        </span>
      ))}
      <button
        type="button"
        className="filter-reset"
        onClick={() => gridStore.getState().clearAllFilters()}
      >
        {t.filterResetAll}
      </button>

      {menu && (
        <ColumnMenu
          key={menu.col}
          col={menu.col}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
