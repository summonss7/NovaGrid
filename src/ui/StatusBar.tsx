import { useStore } from 'zustand'
import { visibleRowsOf } from '../core/filter'
import { gridStore, selectionMetrics } from '../core/store'
import { ru } from '../i18n/ru'

/**
 * Статус-бар метрик (§6, Ф4): Σ · n · x̄ по выделению — живьём при любом
 * изменении. Скрытые фильтром строки не считаются (как в Excel): после
 * «видно 132 строки» Σ показывает сумму именно этих строк (КТ-3).
 */
export function StatusBar() {
  // три примитивные подписки вместо одной объектной — без пересоздания снапшота
  const total = useStore(
    gridStore,
    (s) => selectionMetrics(s.sheet, s.selection, visibleRowsOf(s.sheet, s.filters)).total,
  )
  const count = useStore(
    gridStore,
    (s) => selectionMetrics(s.sheet, s.selection, visibleRowsOf(s.sheet, s.filters)).count,
  )
  const mean = useStore(
    gridStore,
    (s) => selectionMetrics(s.sheet, s.selection, visibleRowsOf(s.sheet, s.filters)).mean,
  )

  return (
    <footer className="status-bar">
      <span className="status-phase">{ru.statusPhase}</span>
      <span className="status-metrics" aria-live="polite">
        <span className="status-metric">Σ {total.toLocaleString('ru-RU')}</span>
        <span className="status-metric">n {count.toLocaleString('ru-RU')}</span>
        <span className="status-metric">x̄ {mean.toLocaleString('ru-RU')}</span>
      </span>
    </footer>
  )
}
