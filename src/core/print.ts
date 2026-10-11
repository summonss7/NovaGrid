/*
 * Печатная форма (Этап 7.4, novagrid-017): сборка данных печати по модели
 * книги — чистый TS без DOM, юнит-тестируемый. Канвас не печатается: по
 * этим данным ui/PrintView рисует таблицу, которую видит только @media print.
 *
 * Анти-скоуп CONCEPT §5: без разбивки/масштабирования Excel-класса — таблица
 * печатается как есть, шапка повторяется нативным thead (table-header-group).
 * Строки идут модельными номерами: скрытые фильтром не сдвигают нумерацию,
 * «Показано 132 из 501» честно в колонтитуле.
 */

import { createStore } from 'zustand/vanilla'
import { isActiveFilter, visibleRowsOf, type ColumnFilter, type FilterMode } from './filter'
import { getStyle, parseNumber, type SheetModel } from './sheet'
import { colName } from '../grid/geometry'
import { cellText } from '../formula/engine'

/** Что печатать: видимые строки (по умолчанию) или весь лист без фильтров. */
export type PrintScope = 'visible' | 'all'
export type PrintOrientation = 'landscape' | 'portrait'
export type PrintPaper = 'a4' | 'letter'

export interface PrintOptions {
  scope: PrintScope
  orientation: PrintOrientation
  paper: PrintPaper
}

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  scope: 'visible',
  orientation: 'landscape',
  paper: 'a4',
}

/**
 * Потолок строк печати: DOM-таблица строится синхронно на beforeprint —
 * стресс-лист 100k строк не должен вешать вкладку. Обрезка показывается
 * в колонтитуле («печать ограничена первыми …»).
 */
export const PRINT_ROW_LIMIT = 20000

/** Локаль печати: числа с разделителями локали, ISO-даты → местный формат. */
export interface PrintLocale {
  num: (n: number) => string
  date: (iso: string) => string
  /** подпись пустого значения в чипе фильтра — та же, что в ленте фильтров */
  filterBlanks: string
  filterChipMore: (n: number) => string
}

export interface PrintCell {
  /** отображаемый текст (формулы — вычисленным значением, числа/даты — локалью) */
  text: string
  numeric: boolean
  bold: boolean
  align: 'left' | 'center' | 'right'
}

export interface PrintRow {
  /** модельный номер строки (0-based) — шапка строк печатает index + 1 */
  index: number
  cells: PrintCell[]
}

export interface PrintData {
  /** буквы колонок A..Z, AA… по границе контента */
  columns: string[]
  rows: PrintRow[]
  /** чипы активных фильтров («A = Иванов») — в колонтитул; «весь лист» → пусто */
  filterChips: string[]
  /** «Показано N из M»; null — фильтров нет или печать всего листа */
  shownOf: { shown: number; total: number } | null
  /** печать обрезана PRINT_ROW_LIMIT; исходное число строк — для заметки */
  truncatedFrom: number | null
}

/** Подпись чипа фильтра — та же логика, что в ленте фильтров (ui/FilterBar). */
export function filterChipLabel(
  col: number,
  mode: FilterMode,
  values: string[],
  locale: Pick<PrintLocale, 'filterBlanks' | 'filterChipMore'>,
): string {
  const first = values[0] === '' ? locale.filterBlanks : values[0]
  const more = values.length > 1 ? ` ${locale.filterChipMore(values.length - 1)}` : ''
  return `${colName(col)} ${mode === 'include' ? '=' : '≠'} ${first}${more}`
}

/** ISO-дата модели («2026-10-11» / «2026-10-11 21:30») → формат локали. */
export function formatIsoDate(iso: string, tag: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(iso)
  if (!m) return iso
  // локальная дата из частей: new Date('2026-10-11') — UTC-полночь, в минусовых
  // часовых поясах уехала бы на день назад
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const date = d.toLocaleDateString(tag)
  return m[4] ? `${date} ${m[4]}:${m[5]}` : date
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/

/** Текст ячейки для печати: числа и ISO-даты — форматом локали. */
function printCellText(raw: string, locale: PrintLocale): string {
  if (raw === '') return ''
  if (ISO_DATE_RE.test(raw)) return locale.date(raw)
  const n = parseNumber(raw)
  return n !== null ? locale.num(n) : raw
}

export function buildPrintData(
  sheet: SheetModel,
  filters: readonly ColumnFilter[],
  locale: PrintLocale,
  scope: PrintScope,
): PrintData {
  const total = sheet.maxRow + 1
  if (total <= 0) {
    return { columns: [], rows: [], filterChips: [], shownOf: null, truncatedFrom: null }
  }
  const visible = scope === 'visible' ? visibleRowsOf(sheet, filters) : null
  const source = visible ?? Array.from({ length: total }, (_, r) => r)
  const truncatedFrom = source.length > PRINT_ROW_LIMIT ? source.length : null
  const rowsToPrint = truncatedFrom !== null ? source.slice(0, PRINT_ROW_LIMIT) : source

  const columns: string[] = []
  for (let c = 0; c <= sheet.maxCol; c++) columns.push(colName(c))

  const rows: PrintRow[] = rowsToPrint.map((r) => {
    const cells: PrintCell[] = []
    for (let c = 0; c <= sheet.maxCol; c++) {
      const style = getStyle(sheet, r, c)
      const raw = cellText(sheet, r, c)
      const text = printCellText(raw, locale)
      // «число?» — по сырому тексту: локализованное («10 000») парсер не берёт
      const numeric = parseNumber(raw) !== null
      cells.push({
        text,
        numeric,
        bold: style?.bold === true,
        align: style?.align ?? (numeric ? 'right' : 'left'),
      })
    }
    return { index: r, cells }
  })

  const active = filters.filter(isActiveFilter)
  return {
    columns,
    rows,
    filterChips:
      scope === 'visible'
        ? active.map((f) => filterChipLabel(f.col, f.mode, f.values, locale))
        : [],
    shownOf:
      scope === 'visible' && active.length > 0
        ? { shown: rowsToPrint.length, total }
        : null,
    truncatedFrom,
  }
}

/** Состояние печати (Этап 7.4): диалог настроек + выбранные опции сессии. */
export interface PrintUiState {
  dialogOpen: boolean
  options: PrintOptions
  openDialog: () => void
  closeDialog: () => void
  applyOptions: (options: PrintOptions) => void
}

export const printStore = createStore<PrintUiState>((set) => ({
  dialogOpen: false,
  options: DEFAULT_PRINT_OPTIONS,
  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
  applyOptions: (options) => set({ options }),
}))
