import { ArrowDownAZ, ArrowUpAZ, Columns3, Pin, PinOff, Search, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { columnValueCounts, type ColumnFilter } from '../core/filter'
import { gridStore } from '../core/store'
import { colName } from '../grid/geometry'
import { useT } from '../i18n'
import { useMenuKeys } from './menuKeys'

/** Сколько значений показывать в списке (дальше — уточняй поиском). */
const LIST_CAP = 500

/** Подтверждение сортировки — один раз за сессию (Ф8: «строки перемешаются»). */
let sortConfirmedOnce = false

/**
 * Меню колонки (CONCEPT Ф3.7 + Ф8): классика для тех, кому привычнее
 * галочек, — сортировка по возрастанию/убыванию (только видимые строки),
 * галочки значений с поиском и «(пустые)», сброс фильтра колонки.
 */
export function ColumnMenu(props: { x: number; y: number; col: number; onClose: () => void }) {
  const t = useT()
  const sheet = useStore(gridStore, (s) => s.sheet)
  const filters = useStore(gridStore, (s) => s.filters)
  const freeze = useStore(gridStore, (s) => s.freeze)
  const [needle, setNeedle] = useState('')
  const { col, onClose } = props
  const menuRef = useRef<HTMLDivElement>(null)
  // фокус в поиск при открытии; стрелки не перехватываем — они нужны каретке
  useMenuKeys(menuRef, onClose, {
    itemSelector: null,
    autoFocusSelector: '.col-menu-word input',
  })

  const letter = colName(col)
  const colFilter = filters.find((f) => f.col === col)

  // полный список значений колонки — по нему строится include-набор
  const all = useMemo(() => columnValueCounts(sheet, col), [sheet, col])

  // невыбранные значения: из текущего фильтра (include) или пусто (всё видно);
  // набор живёт на монтировании меню, поэтому экземпляр рендерится с key={col}
  // (текстовый фильтр «по слову» набора не задаёт — галочки трогаем отдельно)
  const [unchecked, setUnchecked] = useState<Set<string>>(() => {
    const current = gridStore.getState().filters.find((f) => f.col === col)
    if (!current || current.mode !== 'include' || current.text !== undefined) return new Set()
    return new Set(all.map((v) => v.value).filter((v) => !current.values.includes(v)))
  })

  // фильтр «содержит слово» (novagrid-069): «патрубок» найдёт «патрубок
  // воздушного фильтра»; применяется по Enter/кнопке, пустое слово снимает
  const [word, setWord] = useState(
    () => gridStore.getState().filters.find((f) => f.col === col)?.text ?? '',
  )
  const applyWord = () => {
    const w = word.trim()
    if (w === '') {
      gridStore.getState().clearColumnFilter(col)
      return
    }
    gridStore.getState().setColumnFilter({ col, mode: 'include', values: [], text: w })
  }

  const apply = (next: Set<string>) => {
    setUnchecked(next)
    const values = all.map((v) => v.value).filter((v) => !next.has(v))
    gridStore.getState().setColumnFilter({ col, mode: 'include', values } satisfies ColumnFilter)
  }

  const toggle = (value: string) => {
    const next = new Set(unchecked)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    apply(next)
  }

  const sort = (dir: 'asc' | 'desc') => {
    if (!sortConfirmedOnce) {
      if (!window.confirm(t.sortConfirm)) return
      sortConfirmedOnce = true
    }
    gridStore.getState().sortColumn(col, dir)
    onClose()
  }

  const needleLower = needle.trim().toLowerCase()
  const shown = useMemo(() => {
    if (needleLower === '') return all.slice(0, LIST_CAP)
    return all.filter((v) => v.value.toLowerCase().includes(needleLower)).slice(0, LIST_CAP)
  }, [all, needleLower])
  const hiddenCount = Math.max(
    0,
    (needleLower === ''
      ? all.length
      : all.filter((v) => v.value.toLowerCase().includes(needleLower)).length) - shown.length,
  )

  const left = Math.min(props.x, window.innerWidth - 320)
  const top = Math.min(props.y, window.innerHeight - 420)
  const allChecked = unchecked.size === 0

  return (
    <>
      <div className="menu-backdrop" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div
        ref={menuRef}
        className="col-menu"
        style={{ left, top }}
        role="menu"
        aria-label={t.columnMenuLabel(letter)}
      >
        <div className="col-menu-sort" role="group" aria-label={t.sortGroupLabel}>
          <button type="button" role="menuitem" className="ctx-item" onClick={() => sort('asc')}>
            <ArrowUpAZ size={14} strokeWidth={1.5} aria-hidden />
            {t.sortAsc}
          </button>
          <button type="button" role="menuitem" className="ctx-item" onClick={() => sort('desc')}>
            <ArrowDownAZ size={14} strokeWidth={1.5} aria-hidden />
            {t.sortDesc}
          </button>
        </div>

        {/* вставка/удаление колонок и закрепление (novagrid-045/044) */}
        <div className="ctx-sep" aria-hidden />
        <button
          type="button"
          role="menuitem"
          className="ctx-item"
          onClick={() => {
            gridStore.getState().insertCols(col, 1)
            onClose()
          }}
        >
          <Columns3 size={14} strokeWidth={1.5} aria-hidden />
          {t.insertColLeft}
        </button>
        <button
          type="button"
          role="menuitem"
          className="ctx-item"
          onClick={() => {
            gridStore.getState().insertCols(col + 1, 1)
            onClose()
          }}
        >
          <Columns3 size={14} strokeWidth={1.5} aria-hidden />
          {t.insertColRight}
        </button>
        <button
          type="button"
          role="menuitem"
          className="ctx-item"
          onClick={() => {
            gridStore.getState().deleteCols(col, 1)
            onClose()
          }}
        >
          <Trash2 size={14} strokeWidth={1.5} aria-hidden />
          {t.deleteCols(1)}
        </button>
        {freeze.cols > 0 ? (
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            onClick={() => {
              gridStore.getState().setFreeze(freeze.rows, 0)
              onClose()
            }}
          >
            <PinOff size={14} strokeWidth={1.5} aria-hidden />
            {t.freezeNone}
          </button>
        ) : (
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            onClick={() => {
              gridStore.getState().setFreeze(freeze.rows, col + 1)
              onClose()
            }}
          >
            <Pin size={14} strokeWidth={1.5} aria-hidden />
            {t.freezeColsTo(letter)}
          </button>
        )}
        <div className="ctx-sep" aria-hidden />

        <div className="col-menu-word">
          <input
            type="search"
            value={word}
            placeholder={t.filterByWord}
            aria-label={t.filterByWord}
            title={t.filterByWordHint}
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyWord()
              }
            }}
            spellCheck={false}
          />
          <button type="button" className="col-menu-link" onClick={applyWord}>
            {t.filterWordApply}
          </button>
        </div>

        <div className="col-menu-search">
          <Search size={13} strokeWidth={1.5} aria-hidden />
          <input
            type="search"
            value={needle}
            placeholder={t.columnValuesSearch}
            aria-label={t.columnValuesSearch}
            onChange={(e) => setNeedle(e.target.value)}
            spellCheck={false}
          />
        </div>

        <div className="col-menu-list" role="group" aria-label={t.columnValuesLabel}>
          {shown.map((v) => {
            const isBlank = v.value === ''
            const label = isBlank ? t.filterBlanks : v.value
            return (
              <label key={v.value} className="col-menu-value">
                <input
                  type="checkbox"
                  checked={!unchecked.has(v.value)}
                  onChange={() => toggle(v.value)}
                />
                <span className="col-menu-value-text" title={label}>
                  {label}
                </span>
                <span className="col-menu-value-count">{t.num(v.count)}</span>
              </label>
            )
          })}
          {shown.length === 0 && <div className="col-menu-empty">{t.searchNoMatches}</div>}
          {hiddenCount > 0 && (
            <div className="col-menu-capped">
              {t.columnValuesShown(shown.length, shown.length + hiddenCount)}
            </div>
          )}
        </div>

        <div className="col-menu-footer">
          <button
            type="button"
            className="col-menu-link"
            onClick={() => apply(new Set())}
            disabled={allChecked}
          >
            {t.columnSelectAll}
          </button>
          <button
            type="button"
            className="col-menu-link"
            onClick={() => {
              gridStore.getState().clearColumnFilter(col)
              onClose()
            }}
            disabled={!colFilter}
          >
            {t.columnResetFilter}
          </button>
        </div>
      </div>
    </>
  )
}
