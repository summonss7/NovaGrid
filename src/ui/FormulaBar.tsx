import { useStore } from 'zustand'
import { gridStore } from '../core/store'
import { getCell } from '../core/sheet'
import { cellRefName } from '../grid/geometry'
import { ru } from '../i18n/ru'

/**
 * Строка формул: адрес активной ячейки + её значение. Живое редактирование
 * и показ формул — Этап 4 (4.3); сейчас значение readOnly.
 */
export function FormulaBar() {
  const ref = useStore(gridStore, (s) =>
    cellRefName(s.selection.active.row, s.selection.active.col),
  )
  const value = useStore(gridStore, (s) =>
    getCell(s.sheet, s.selection.active.row, s.selection.active.col),
  )

  return (
    <div className="formula-bar">
      <span className="formula-badge" aria-hidden>
        {ru.formulaLabel}
      </span>
      <span className="formula-ref" aria-label="Адрес активной ячейки">
        {ref}
      </span>
      <input
        className="formula-input"
        readOnly
        value={value}
        placeholder={ru.formulaPlaceholder}
        aria-label="Строка формул"
      />
    </div>
  )
}
