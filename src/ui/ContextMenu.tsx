import { Copy, Filter, FilterX, ListPlus } from 'lucide-react'
import { useEffect } from 'react'
import { useStore } from 'zustand'
import { colName } from '../grid/geometry'
import { gridStore } from '../core/store'
import { cellText } from '../formula/engine'
import { ru } from '../i18n/ru'
import { copyText } from './clipboard'

/**
 * Контекстное меню ПКМ по ячейке (CONCEPT Ф3, DESIGN-SYSTEM §7) — ключевой
 * жест ТЗ: «Фильтровать: A = «Иванов»» первым пунктом, инверсия, добавление
 * значения к фильтру, сброс, копирование. Значение берётся то, на котором
 * нажали, — без диалогов.
 */
export function ContextMenu(props: {
  x: number
  y: number
  row: number
  col: number
  onClose: () => void
}) {
  const filters = useStore(gridStore, (s) => s.filters)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])

  const st = gridStore.getState()
  // отображаемое значение: фильтры сравнивают то, что видно (формулы вычислены)
  const raw = cellText(st.sheet, props.row, props.col)
  const value = raw === '' ? ru.filterBlanks : raw
  const letter = colName(props.col)
  const colFilter = filters.find((f) => f.col === props.col)
  const canAdd =
    colFilter !== undefined && colFilter.mode === 'include' && !colFilter.values.includes(raw)

  const act = (fn: () => void) => () => {
    fn()
    props.onClose()
  }

  const copyValue = async (text: string) => {
    await copyText(text)
    props.onClose()
  }

  // строка для «Копировать строку»: значения колонок контента через таб
  const rowText = Array.from({ length: st.sheet.maxCol + 1 }, (_, c) =>
    cellText(st.sheet, props.row, c),
  ).join('\t')

  // не вылезать за пределы окна
  const left = Math.min(props.x, window.innerWidth - 300)
  const top = Math.min(props.y, window.innerHeight - 330)

  return (
    <>
      <div
        className="menu-backdrop"
        onClick={props.onClose}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="ctx-menu" style={{ left, top }} role="menu" aria-label={ru.ctxMenuLabel}>
        <button
          type="button"
          role="menuitem"
          className="ctx-item ctx-item-primary"
          onClick={act(() => st.filterByValue(props.col, raw))}
        >
          <Filter size={14} strokeWidth={1.5} aria-hidden />
          <span className="ctx-item-text">{ru.ctxFilterEqual(letter, value)}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="ctx-item"
          onClick={act(() => st.excludeByValue(props.col, raw))}
        >
          <FilterX size={14} strokeWidth={1.5} aria-hidden />
          <span className="ctx-item-text">{ru.ctxFilterNotEqual(letter, value)}</span>
        </button>
        {canAdd && (
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            onClick={act(() => st.addValueToFilter(props.col, raw))}
          >
            <ListPlus size={14} strokeWidth={1.5} aria-hidden />
            <span className="ctx-item-text">{ru.ctxAddValue(value)}</span>
          </button>
        )}
        {colFilter && (
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            onClick={act(() => st.clearColumnFilter(props.col))}
          >
            <span className="ctx-item-text">{ru.ctxClearColumn(letter)}</span>
          </button>
        )}
        {filters.length > 0 && (
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            onClick={act(() => st.clearAllFilters())}
          >
            <span className="ctx-item-text">{ru.ctxClearAll}</span>
          </button>
        )}
        <div className="ctx-sep" aria-hidden />
        <button
          type="button"
          role="menuitem"
          className="ctx-item"
          onClick={() => void copyValue(raw)}
        >
          <Copy size={14} strokeWidth={1.5} aria-hidden />
          <span className="ctx-item-text">{ru.ctxCopyCell}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="ctx-item"
          onClick={() => void copyValue(rowText)}
        >
          <Copy size={14} strokeWidth={1.5} aria-hidden />
          <span className="ctx-item-text">{ru.ctxCopyRow}</span>
        </button>
      </div>
    </>
  )
}
