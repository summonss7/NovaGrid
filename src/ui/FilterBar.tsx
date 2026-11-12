import { X } from 'lucide-react'
import { useState } from 'react'
import { useStore } from 'zustand'
import { colName } from '../grid/geometry'
import { filterChipLabel } from '../core/print'
import { gridStore } from '../core/store'
import { useT } from '../i18n'
import { ColumnMenu } from './ColumnMenu'

/**
 * Лента чипов активных фильтров (CONCEPT Ф3.4, DESIGN-SYSTEM §6): строка под
 * тулбаром — [A: Иванов ×] [C: 10000 ×] … [Сбросить всё]. Крестик снимает
 * один фильтр, клик по чипу открывает меню колонки (редактирование списка).
 * Подпись чипа — общий помощник core/print (та же подпись в колонтитуле печати).
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
            {filterChipLabel(f.col, f.mode, f.values, t, f.text)}
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
