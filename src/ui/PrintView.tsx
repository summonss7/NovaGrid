import { useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { useStore } from 'zustand'
import {
  PRINT_ROW_LIMIT,
  buildPrintData,
  formatIsoDate,
  printStore,
  type PrintCell,
  type PrintLocale,
} from '../core/print'
import { gridStore } from '../core/store'
import { useT } from '../i18n'

/**
 * Печатная страница (Этап 7.4): таблица по модели книги — канвас не печатается.
 * На экране её нет (display:none вне @media print); DOM собирается синхронно
 * на beforeprint (flushSync — предпросмотр печати ждёт DOM) и по смене
 * print-среды (matchMedia — путь e2e/эмуляции), после печати снимается.
 * Строки — видимые с учётом фильтров (модельные номера), шапка колонок
 * повторяется на каждой странице нативным thead (table-header-group).
 */
export function PrintView() {
  const t = useT()
  const sheet = useStore(gridStore, (s) => s.sheet)
  const filters = useStore(gridStore, (s) => s.filters)
  const fileName = useStore(gridStore, (s) => s.fileName)
  const sheetName = useStore(gridStore, (s) => s.tabs[s.activeTab]?.name ?? '')
  const options = useStore(printStore, (s) => s.options)
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('print')
    const start = () => flushSync(() => setPrinting(true))
    const stop = () => setPrinting(false)
    const onChange = () => (mq.matches ? start() : stop())
    window.addEventListener('beforeprint', start)
    window.addEventListener('afterprint', stop)
    mq.addEventListener('change', onChange)
    // эффект поставлен уже в print-среде (эмуляция до монтирования)
    if (mq.matches) start()
    return () => {
      window.removeEventListener('beforeprint', start)
      window.removeEventListener('afterprint', stop)
      mq.removeEventListener('change', onChange)
    }
  }, [])

  // @page: формат/ориентация подставляются в предпросмотр Chromium по умолчанию
  useEffect(() => {
    const paper = options.paper === 'letter' ? 'Letter' : 'A4'
    const orient = options.orientation === 'portrait' ? 'portrait' : 'landscape'
    let el = document.getElementById('nv-print-page') as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = 'nv-print-page'
      document.head.appendChild(el)
    }
    el.textContent = `@page { size: ${paper} ${orient}; margin: 12mm; }`
  }, [options.paper, options.orientation])

  const locale: PrintLocale = useMemo(
    () => ({
      num: t.num,
      date: (iso) => formatIsoDate(iso, t.localeTag),
      filterBlanks: t.filterBlanks,
      filterChipMore: t.filterChipMore,
      filterChipContains: t.filterChipContains,
      filterChipNotContains: t.filterChipNotContains,
    }),
    [t],
  )

  const data = useMemo(
    () => (printing ? buildPrintData(sheet, filters, locale, options.scope) : null),
    [printing, sheet, filters, locale, options.scope],
  )
  if (!data) return null

  return (
    <div className="print-root" aria-hidden="true">
      <header className="print-head">
        <span className="print-title">
          {fileName ?? t.unsavedBook} · {sheetName}
        </span>
        {data.filterChips.length > 0 && (
          <span className="print-chips">{data.filterChips.join(' · ')}</span>
        )}
        {data.shownOf && (
          <span className="print-shown">
            {t.filterShownOf(data.shownOf.shown, data.shownOf.total)}
          </span>
        )}
        {data.truncatedFrom !== null && (
          <span className="print-note">{t.printTruncated(PRINT_ROW_LIMIT)}</span>
        )}
      </header>
      <table className="print-table">
        <thead>
          <tr>
            <th className="print-row-head" scope="col" aria-label="#" />
            {data.columns.map((name) => (
              <th key={name} scope="col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.index}>
              <th className="print-row-head" scope="row">
                {row.index + 1}
              </th>
              {row.cells.map((cell, c) => (
                <td key={c} className={cellClass(cell)}>
                  {cell.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function cellClass(cell: PrintCell): string {
  const cls = ['print-c']
  if (cell.align === 'right') cls.push('print-c-right')
  else if (cell.align === 'center') cls.push('print-c-center')
  if (cell.bold) cls.push('print-c-bold')
  return cls.join(' ')
}
