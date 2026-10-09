import { useStore } from 'zustand'
import { visibleRowsOf } from '../core/filter'
import { gridStore, selectionMetrics } from '../core/store'
import { zoomStore } from '../grid/zoom'
import { ru } from '../i18n/ru'

/**
 * Статус-бар метрик (§6, Ф4): Σ · n · x̄ по выделению — живьём при любом
 * изменении. Скрытые фильтром строки не считаются (как в Excel): после
 * «видно 132 строки» Σ показывает сумму именно этих строк (КТ-3).
 * Этап 5.3: справа контрол масштаба таблицы (− % +) — тот же зум, что пинч
 * и Ctrl+колесо; на мобильном метрики растут до «крупной плашки» (§9).
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
  const zoom = useStore(zoomStore, (s) => s.zoom)

  return (
    <footer className="status-bar">
      <span className="status-phase">{ru.statusPhase}</span>
      <span className="status-metrics" aria-live="polite">
        <span className="status-metric">Σ {total.toLocaleString('ru-RU')}</span>
        <span className="status-metric">n {count.toLocaleString('ru-RU')}</span>
        <span className="status-metric">x̄ {mean.toLocaleString('ru-RU')}</span>
      </span>
      <span className="zoom-ctl" role="group" aria-label={ru.zoomLabel}>
        <button
          type="button"
          className="zoom-btn"
          aria-label={ru.zoomOut}
          title={ru.zoomOut}
          onClick={() => zoomStore.getState().setZoom(zoom - 0.1)}
        >
          −
        </button>
        <button
          type="button"
          className="zoom-value"
          aria-label={ru.zoomReset}
          title={ru.zoomReset}
          onClick={() => zoomStore.getState().setZoom(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="zoom-btn"
          aria-label={ru.zoomIn}
          title={ru.zoomIn}
          onClick={() => zoomStore.getState().setZoom(zoom + 0.1)}
        >
          +
        </button>
      </span>
    </footer>
  )
}
