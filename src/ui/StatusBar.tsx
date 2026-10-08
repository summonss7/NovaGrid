import { useStore } from 'zustand'
import { gridStore, selectionMetrics } from '../core/store'
import { ru } from '../i18n/ru'

/** Статус-бар метрик (§6): Σ · n · x̄ по выделению — живьём при любом изменении. */
export function StatusBar() {
  // три примитивные подписки вместо одной объектной — без пересоздания снапшота
  const total = useStore(gridStore, (s) => selectionMetrics(s.sheet, s.selection).total)
  const count = useStore(gridStore, (s) => selectionMetrics(s.sheet, s.selection).count)
  const mean = useStore(gridStore, (s) => selectionMetrics(s.sheet, s.selection).mean)

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
