import { average, sum } from '../core/stats'
import { ru } from '../i18n/ru'

/**
 * Статус-бар метрик (§6): Σ · n · x̄ по выделению. Пока данных нет (Этап 0),
 * метрики считаются честной функцией core/stats по пустому набору — и оживут
 * с появлением выделения на Этапе 1.
 */
export function StatusBar() {
  const values: readonly number[] = []
  const total = sum(values)
  const count = values.length
  const mean = average(values)

  return (
    <footer className="status-bar">
      <span className="status-phase">{ru.statusPhase}</span>
      <span className="status-metrics">
        <span className="status-metric">Σ {total.toLocaleString('ru-RU')}</span>
        <span className="status-metric">n {count}</span>
        <span className="status-metric">x̄ {mean.toLocaleString('ru-RU')}</span>
      </span>
    </footer>
  )
}
