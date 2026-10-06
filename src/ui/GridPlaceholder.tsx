import { ru } from '../i18n/ru'

const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F']
const ROWS = 14

/**
 * Заглушка зоны грида: шапки колонок/строк в surface и сетка линий —
 * каркас раскладки. Настоящий канвас-грид (виртуализация, жесты) — Этап 1.
 */
export function GridPlaceholder() {
  return (
    <main className="grid-area" aria-label="Область таблицы">
      <div className="grid-skeleton" aria-hidden="true">
        {/* угловая ячейка + шапки колонок */}
        <span className="grid-cell grid-head grid-corner" />
        {COLUMNS.map((c) => (
          <span key={c} className="grid-cell grid-head">
            {c}
          </span>
        ))}
        {/* строки: номер + пустые ячейки */}
        {Array.from({ length: ROWS }, (_, i) => (
          <Row key={i} n={i + 1} />
        ))}
      </div>

      <div className="grid-overlay">
        <div className="grid-overlay-card">
          <div className="grid-overlay-title">{ru.gridTitle}</div>
          <p className="grid-overlay-text">{ru.gridText}</p>
        </div>
      </div>
    </main>
  )
}

function Row({ n }: { n: number }) {
  return (
    <>
      <span className="grid-cell grid-head grid-rowhead">{n}</span>
      {COLUMNS.map((c) => (
        <span key={c} className="grid-cell" />
      ))}
    </>
  )
}
