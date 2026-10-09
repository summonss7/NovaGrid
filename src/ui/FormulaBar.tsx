import { useRef, useState } from 'react'
import { ChevronUp } from 'lucide-react'
import { useStore } from 'zustand'
import { gridStore } from '../core/store'
import { getCell } from '../core/sheet'
import { cellError, cellIsFrozen } from '../formula/engine'
import { cellRefName } from '../grid/geometry'
import { ru } from '../i18n/ru'
import { AssistPopup } from './AssistPopup'
import { useFormulaAssist } from './useFormulaAssist'
import { useIsMobile } from './useIsMobile'

/**
 * Строка формул (Этап 4.3, Ф6): показывает формулу активной ячейки (или её
 * значение), редактируется на месте — правка через beginBarEdit живёт в
 * edit-состоянии стора, Enter фиксирует, Esc отменяет. Ошибки формул —
 * человеческим языком справа; чужие формулы помечаются «∛ не пересчитывается».
 * При вводе «=» — автодополнение функций и подсказки аргументов (4.4).
 * Этап 5.2: на мобильном сворачивается до «fx A1» — раскрывается касанием
 * по адресу активной ячейки (DESIGN-SYSTEM §9); правка формулы на телефоне
 * редка, экран дорог.
 */
export function FormulaBar() {
  const inputRef = useRef<HTMLInputElement>(null)
  const mobile = useIsMobile()
  const [expanded, setExpanded] = useState(false)
  const ref = useStore(gridStore, (s) =>
    cellRefName(s.selection.active.row, s.selection.active.col),
  )
  const raw = useStore(gridStore, (s) =>
    getCell(s.sheet, s.selection.active.row, s.selection.active.col),
  )
  const error = useStore(gridStore, (s) =>
    cellError(s.sheet, s.selection.active.row, s.selection.active.col),
  )
  const frozen = useStore(gridStore, (s) =>
    cellIsFrozen(s.sheet, s.selection.active.row, s.selection.active.col),
  )
  const edit = useStore(gridStore, (s) => s.edit)
  const active = useStore(gridStore, (s) => s.selection.active)
  const editingThis = edit !== null && edit.row === active.row && edit.col === active.col
  const value = editingThis ? edit.value : raw
  // мобильный свёрнут — но начатая правка не должна потеряться из виду
  const collapsed = mobile && !expanded && !editingThis

  const apply = (next: { value: string; caret: number }) => {
    gridStore.getState().setEditValue(next.value)
    const el = inputRef.current
    if (el) requestAnimationFrame(() => el.setSelectionRange(next.caret, next.caret))
  }
  const assist = useFormulaAssist(editingThis && edit?.source === 'bar' ? value : '', apply)

  const focusGrid = () => {
    document.querySelector<HTMLElement>('.grid-area')?.focus({ preventScroll: true })
  }

  return (
    <div className={`formula-bar${collapsed ? ' formula-bar-collapsed' : ''}`}>
      <span className="formula-badge" aria-hidden>
        {ru.formulaLabel}
      </span>
      {collapsed ? (
        <button
          type="button"
          className="formula-ref formula-ref-btn"
          aria-label={ru.formulaExpand}
          title={ru.formulaExpand}
          onClick={() => setExpanded(true)}
        >
          {ref}
        </button>
      ) : (
        <span className="formula-ref" aria-label="Адрес активной ячейки">
          {ref}
        </span>
      )}
      {!collapsed && (
        <>
          <input
            ref={inputRef}
            className="formula-input"
            value={value}
            placeholder={ru.formulaPlaceholder}
            aria-label={ru.formulaBarLabel}
            spellCheck={false}
            onFocus={() => {
              if (!editingThis) gridStore.getState().beginBarEdit()
            }}
            onChange={(e) => {
              if (!gridStore.getState().edit) gridStore.getState().beginBarEdit()
              gridStore.getState().setEditValue(e.target.value)
              assist.sync(e.target.selectionStart ?? 0)
            }}
            onKeyUp={(e) => assist.sync(e.currentTarget.selectionStart ?? 0)}
            onClick={(e) => assist.sync(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={(e) => {
              if (assist.handleKeys(e.key)) {
                e.preventDefault()
                e.stopPropagation()
                return
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                if (gridStore.getState().edit) gridStore.getState().commitEdit('none')
                focusGrid()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                if (gridStore.getState().edit) gridStore.getState().cancelEdit()
              }
            }}
            onBlur={() => {
              // уход фокуса фиксирует правку — как в Excel
              if (gridStore.getState().edit?.source === 'bar') gridStore.getState().commitEdit('none')
            }}
          />
          {frozen && !editingThis && (
            <span className="formula-frozen" title={ru.formulaFrozenHint}>
              {ru.formulaFrozen}
            </span>
          )}
          {error && !editingThis && (
            <span className="formula-error" role="alert" title={error}>
              {error}
            </span>
          )}
          {mobile && (
            <button
              type="button"
              className="btn btn-ghost btn-icon formula-collapse"
              aria-label={ru.formulaCollapse}
              title={ru.formulaCollapse}
              onClick={() => setExpanded(false)}
            >
              <ChevronUp size={16} strokeWidth={1.5} aria-hidden />
            </button>
          )}
        </>
      )}
      {edit?.source === 'bar' && assist.assist && (
        <AssistPopup
          anchor={inputRef}
          assist={assist.assist}
          activeIdx={assist.activeIdx}
          onPick={assist.pick}
        />
      )}
    </div>
  )
}
