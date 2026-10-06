import { ru } from '../i18n/ru'

/** Строка формул — заглушка каркаса; живой показ формулы/значения — Этап 4 (4.3). */
export function FormulaBar() {
  return (
    <div className="formula-bar">
      <span className="formula-badge" aria-hidden>
        {ru.formulaLabel}
      </span>
      <input
        className="formula-input"
        readOnly
        placeholder={ru.formulaPlaceholder}
        aria-label="Строка формул"
      />
    </div>
  )
}
