import { useStore } from 'zustand'
import { visibleRowsOf } from '../core/filter'
import { gridStore, selectionMetrics } from '../core/store'
import { cellText } from '../formula/engine'
import { cellRefName } from '../grid/geometry'
import { zoomStore } from '../grid/zoom'
import { useT } from '../i18n'
import { useMemo, useState } from 'react'
import { APP_BUILD_DATE, APP_VERSION } from '../app/titleSync'
import { SumCard } from './SumCard'
import { useIsMobile } from './useIsMobile'

/**
 * Статус-бар метрик (§6, Ф4): Σ · n · x̄ по выделению — живьём при любом
 * изменении. Скрытые фильтром строки не считаются (как в Excel): после
 * «видно 132 строки» Σ показывает сумму именно этих строк (КТ-3).
 * Этап 5.3: справа контрол масштаба таблицы (− % +) — тот же зум, что пинч
 * и Ctrl+колесо; на мобильном метрики растут до «крупной плашки» (§9).
 * Этап 6.2: скрытый живой регион объявляет скринридеру активную ячейку
 * (у канвас-грида нет DOM-ячеек — паттерн canvas+aria-live).
 * Этап 6.1: метрики считаются один раз на изменение (было — три подписки,
 * каждая пересчитывала агрегат по всему выделению).
 * novagrid-066: метрики — кнопка: клик/тап открывает карточку метрик
 * (на мобильном шеврон тулбара скрыт — это главный вход в «сколько будет»);
 * подсказка автосуммы видна и на мобильном (раньше пряталась вместе с
 * версией — Σ включала режим молча).
 */
export function StatusBar() {
  const t = useT()
  const sheet = useStore(gridStore, (s) => s.sheet)
  const selection = useStore(gridStore, (s) => s.selection)
  const filters = useStore(gridStore, (s) => s.filters)
  const zoom = useStore(zoomStore, (s) => s.zoom)
  const sumPick = useStore(gridStore, (s) => s.sumPick)
  const isMobile = useIsMobile()
  const [cardOpen, setCardOpen] = useState(false)

  const metrics = useMemo(
    () => selectionMetrics(sheet, selection, visibleRowsOf(sheet, filters)),
    [sheet, selection, filters],
  )
  const activeRef = cellRefName(selection.active.row, selection.active.col)
  const activeText = cellText(sheet, selection.active.row, selection.active.col)

  return (
    <footer className="status-bar">
      {sumPick ? (
        // Σ ждёт выбора ячеек (novagrid-020): живая подсказка вместо метки фазы;
        // на касании Esc нет — отмена повторным тапом по «Сумма» (novagrid-066)
        <span className="status-phase status-sum-pick" role="status">
          {(isMobile ? t.sumPickHintTouch : t.sumPickHint)(
            cellRefName(sumPick.row, sumPick.col),
          )}
        </span>
      ) : (
        // версия программы (novagrid-043): тот же источник, что у заголовка
        // окна — package.json; novagrid-055 добавил дату сборки «от дд.мм.гггг»
        <span className="status-phase">
          NovaGrid v{APP_VERSION} {t.versionDateOf} {APP_BUILD_DATE}
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {activeText !== '' ? `${activeRef} · ${activeText}` : activeRef}
      </span>
      <button
        type="button"
        className="status-metrics"
        aria-label={t.statusMetricsTitle}
        title={t.statusMetricsTitle}
        aria-expanded={cardOpen}
        onClick={() => setCardOpen((v) => !v)}
      >
        <span className="status-metric" aria-live="polite">
          Σ {t.num(metrics.total)}
        </span>
        <span className="status-metric">n {t.num(metrics.count)}</span>
        <span className="status-metric">x̄ {t.num(metrics.mean)}</span>
      </button>
      {cardOpen && <SumCard onClose={() => setCardOpen(false)} />}
      <span className="zoom-ctl" role="group" aria-label={t.zoomLabel}>
        <button
          type="button"
          className="zoom-btn"
          aria-label={t.zoomOut}
          title={t.zoomOut}
          onClick={() => zoomStore.getState().setZoom(zoom - 0.1)}
        >
          −
        </button>
        <button
          type="button"
          className="zoom-value"
          aria-label={t.zoomReset}
          title={t.zoomReset}
          onClick={() => zoomStore.getState().setZoom(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="zoom-btn"
          aria-label={t.zoomIn}
          title={t.zoomIn}
          onClick={() => zoomStore.getState().setZoom(zoom + 0.1)}
        >
          +
        </button>
      </span>
    </footer>
  )
}
