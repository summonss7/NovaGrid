import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { visibleRowsOf } from '../core/filter'
import { gridStore, selectionMetrics } from '../core/store'
import { ru } from '../i18n/ru'
import { copyText } from './clipboard'

/**
 * Карточка метрик выделения (CONCEPT Ф4, DESIGN-SYSTEM §6): открывается
 * кликом по большой кнопке Σ. Сумма / Кол-во чисел / Кол-во заполненных /
 * Среднее / Мин / Макс; клик по строке копирует значение. Считаются только
 * видимые строки (как Σ в статус-баре Excel при фильтре).
 */
export function SumCard(props: { onClose: () => void }) {
  // примитивные подписки (как StatusBar): объектный селектор пересоздавал
  // снапшот на каждый notify и загонял React в бесконечный ре-рендер
  const total = useStore(
    gridStore,
    (s) => selectionMetrics(s.sheet, s.selection, visibleRowsOf(s.sheet, s.filters)).total,
  )
  const count = useStore(
    gridStore,
    (s) => selectionMetrics(s.sheet, s.selection, visibleRowsOf(s.sheet, s.filters)).count,
  )
  const filled = useStore(
    gridStore,
    (s) => selectionMetrics(s.sheet, s.selection, visibleRowsOf(s.sheet, s.filters)).filled,
  )
  const mean = useStore(
    gridStore,
    (s) => selectionMetrics(s.sheet, s.selection, visibleRowsOf(s.sheet, s.filters)).mean,
  )
  const min = useStore(
    gridStore,
    (s) => selectionMetrics(s.sheet, s.selection, visibleRowsOf(s.sheet, s.filters)).min,
  )
  const max = useStore(
    gridStore,
    (s) => selectionMetrics(s.sheet, s.selection, visibleRowsOf(s.sheet, s.filters)).max,
  )
  const m = { total, count, filled, mean, min, max }
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])

  const rows: { label: string; value: number | null; strong?: boolean }[] = [
    { label: ru.metricSum, value: m.total, strong: true },
    { label: ru.metricCount, value: m.count },
    { label: ru.metricFilled, value: m.filled },
    { label: ru.metricMean, value: m.mean },
    { label: ru.metricMin, value: m.min },
    { label: ru.metricMax, value: m.max },
  ]

  const copy = async (value: number | null) => {
    if (value === null) return
    const ok = await copyText(String(value))
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <>
      <div
        className="menu-backdrop"
        onClick={props.onClose}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="sum-card" role="dialog" aria-label={ru.sumTitle}>
        {rows.map((r) => (
          <button
            type="button"
            key={r.label}
            className={r.strong ? 'sum-card-row sum-card-row-strong' : 'sum-card-row'}
            onClick={() => void copy(r.value)}
          >
            <span>{r.label}</span>
            <span className="sum-card-value">
              {r.value === null ? '—' : r.value.toLocaleString('ru-RU')}
            </span>
          </button>
        ))}
        <div className="sum-card-hint">{copied ? ru.metricCopied : ru.metricCopyHint}</div>
      </div>
    </>
  )
}
