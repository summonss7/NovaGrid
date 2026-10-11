import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRINT_OPTIONS,
  PRINT_ROW_LIMIT,
  buildPrintData,
  filterChipLabel,
  formatIsoDate,
  type PrintLocale,
} from './print'
import type { ColumnFilter } from './filter'
import { cellKey, createSheet, withCell, withStyle, type SheetModel } from './sheet'
import { recalcSheet } from '../formula/engine'

/*
 * Этап 7.4 «Печатные формы» — юнит сборки печатных данных: фильтры/скоуп,
 * локаль чисел и дат, пустой лист, стили, лимит строк, подписи чипов.
 * Печатный DOM ( скрытие UI в @media print) проверяет tests/print.spec.ts.
 */

const ru: PrintLocale = {
  num: (n) => n.toLocaleString('ru-RU'),
  date: (iso) => formatIsoDate(iso, 'ru-RU'),
  filterBlanks: '(пустые)',
  filterChipMore: (n) => `+${n}`,
}

/** Лист из строк-массивов (как демо-данные store). */
function sheetFromRows(rows: readonly (readonly string[])[]): SheetModel {
  const cells = new Map<string, string>()
  let maxRow = -1
  let maxCol = -1
  rows.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v !== '') {
        cells.set(cellKey(r, c), v)
        maxRow = Math.max(maxRow, r)
        maxCol = Math.max(maxCol, c)
      }
    }),
  )
  return { cells, styles: new Map(), rows: Math.max(100, rows.length), cols: 26, maxRow, maxCol }
}

const DEMO = [
  ['Фамилия', 'Отдел', 'Сумма'],
  ['Иванов', 'Продажи', '10000'],
  ['Петров', 'Логистика', '12500'],
  ['Иванов', 'Бухгалтерия', '8000'],
  ['', '', ''],
  ['Сидоров', '', '4200'],
]

describe('buildPrintData', () => {
  it('пустой лист: ни колонок, ни строк, чипов нет', () => {
    const data = buildPrintData(createSheet(), [], ru, 'visible')
    expect(data.columns).toEqual([])
    expect(data.rows).toEqual([])
    expect(data.filterChips).toEqual([])
    expect(data.shownOf).toBeNull()
    expect(data.truncatedFrom).toBeNull()
  })

  it('без фильтров: все строки контента, числа локалью, колонки-буквы', () => {
    const data = buildPrintData(sheetFromRows(DEMO), [], ru, 'visible')
    expect(data.columns).toEqual(['A', 'B', 'C'])
    expect(data.rows.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5])
    expect(data.shownOf).toBeNull() // «Показано N из M» без фильтров не нужно
    // числа — форматом локали (ru: пробел-разделитель)
    expect(data.rows[1].cells[2].text).toMatch(/^10[\s\u00a0\u202f]000$/)
    expect(data.rows[1].cells[2].numeric).toBe(true)
    expect(data.rows[1].cells[2].align).toBe('right')
    // текст — как есть, выравнивание слева
    expect(data.rows[1].cells[0]).toMatchObject({ text: 'Иванов', numeric: false, align: 'left' })
    // пустая строка 4 в печати остаётся (номера модельные, не сдвигаются)
    expect(data.rows[4].cells.every((c) => c.text === '')).toBe(true)
  })

  it('фильтр A = Иванов: только подходящие строки, чип и «Показано 2 из 6»', () => {
    const sheet = sheetFromRows(DEMO)
    const filters: ColumnFilter[] = [{ col: 0, mode: 'include', values: ['Иванов'] }]
    const data = buildPrintData(sheet, filters, ru, 'visible')
    // строка 4 (пустая) исключена include-фильтром, 5 (Сидоров) — не Иванов
    expect(data.rows.map((r) => r.index)).toEqual([1, 3])
    expect(data.filterChips).toEqual(['A = Иванов'])
    expect(data.shownOf).toEqual({ shown: 2, total: 6 })
  })

  it('два фильтра по «И» (сценарий ТЗ): чипы обеих колонок', () => {
    const sheet = sheetFromRows(DEMO)
    const filters: ColumnFilter[] = [
      { col: 0, mode: 'include', values: ['Иванов'] },
      { col: 2, mode: 'include', values: ['10000'] },
    ]
    const data = buildPrintData(sheet, filters, ru, 'visible')
    expect(data.rows.map((r) => r.index)).toEqual([1])
    expect(data.filterChips).toEqual(['A = Иванов', 'C = 10000'])
    expect(data.shownOf).toEqual({ shown: 1, total: 6 })
  })

  it('скоуп «весь лист»: фильтры игнорируются, чипов и счётчика нет', () => {
    const sheet = sheetFromRows(DEMO)
    const filters: ColumnFilter[] = [{ col: 0, mode: 'include', values: ['Иванов'] }]
    const data = buildPrintData(sheet, filters, ru, 'all')
    expect(data.rows.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5])
    expect(data.filterChips).toEqual([])
    expect(data.shownOf).toBeNull()
  })

  it('даты ISO печатаются форматом локали (дата и дата+время)', () => {
    const sheet = sheetFromRows([
      ['День', 'Событие'],
      ['2026-10-11', 'созвон'],
      ['2026-01-02 09:30', 'планёрка'],
    ])
    const data = buildPrintData(sheet, [], ru, 'visible')
    expect(data.rows[1].cells[0].text).toBe('11.10.2026')
    expect(data.rows[2].cells[0].text).toBe('02.01.2026 09:30')
  })

  it('стили переносятся: жирность и выравнивание шапки', () => {
    let sheet = withCell(sheetFromRows([['Шапка', '10']]), 0, 0, 'Шапка')
    sheet = withStyle(sheet, 0, 0, { bold: true, align: 'center' })
    const data = buildPrintData(sheet, [], ru, 'visible')
    expect(data.rows[0].cells[0]).toMatchObject({ bold: true, align: 'center' })
    expect(data.rows[0].cells[1].bold).toBe(false)
  })

  it('формулы печатаются вычисленным значением (локаль числа)', () => {
    const sheet = sheetFromRows([
      ['Сумма', 'Итог'],
      ['10000', '=A2*2'],
    ])
    recalcSheet(sheet) // прогрев кэша значений движка
    const data = buildPrintData(sheet, [], ru, 'visible')
    expect(data.rows[1].cells[1].text).toMatch(/^20[\s\u00a0\u202f]000$/)
    expect(data.rows[1].cells[1].numeric).toBe(true)
  })

  it('лимит: сверх PRINT_ROW_LIMIT строки обрезаются, источник в truncatedFrom', () => {
    const cells = new Map<string, string>()
    const n = PRINT_ROW_LIMIT + 5
    for (let r = 0; r < n; r++) cells.set(cellKey(r, 0), String(r + 1))
    const sheet: SheetModel = {
      cells,
      styles: new Map(),
      rows: n,
      cols: 26,
      maxRow: n - 1,
      maxCol: 0,
    }
    const data = buildPrintData(sheet, [], ru, 'visible')
    expect(data.rows).toHaveLength(PRINT_ROW_LIMIT)
    expect(data.truncatedFrom).toBe(n)
    expect(data.shownOf).toBeNull() // без фильтров счётчика нет
  })

  it('лимит + фильтр: «Показано» считает напечатанные строки', () => {
    const cells = new Map<string, string>()
    const n = PRINT_ROW_LIMIT + 5
    for (let r = 0; r < n; r++) cells.set(cellKey(r, 0), r % 2 === 0 ? 'да' : 'нет')
    const sheet: SheetModel = {
      cells,
      styles: new Map(),
      rows: n,
      cols: 26,
      maxRow: n - 1,
      maxCol: 0,
    }
    const data = buildPrintData(sheet, [{ col: 0, mode: 'include', values: ['да'] }], ru, 'visible')
    expect(data.rows).toHaveLength((n + 1) / 2) // чётных на 1 больше — лимит не задет
    expect(data.truncatedFrom).toBeNull()
    expect(data.shownOf).toEqual({ shown: (n + 1) / 2, total: n })
  })
})

describe('filterChipLabel', () => {
  it('include/exclude, пустые значения, счётчик остальных', () => {
    expect(filterChipLabel(0, 'include', ['Иванов'], ru)).toBe('A = Иванов')
    expect(filterChipLabel(2, 'exclude', ['10000'], ru)).toBe('C ≠ 10000')
    expect(filterChipLabel(1, 'include', [''], ru)).toBe('B = (пустые)')
    expect(filterChipLabel(0, 'include', ['Иванов', 'Петров', 'Сидоров'], ru)).toBe(
      'A = Иванов +2',
    )
  })
})

describe('formatIsoDate', () => {
  it('ru и en локали, не-дата проходит как есть', () => {
    expect(formatIsoDate('2026-10-11', 'ru-RU')).toBe('11.10.2026')
    expect(formatIsoDate('2026-10-11', 'en-US')).toBe('10/11/2026')
    expect(formatIsoDate('2026-10-11 21:30', 'ru-RU')).toBe('11.10.2026 21:30')
    expect(formatIsoDate('Иванов', 'ru-RU')).toBe('Иванов')
  })
})

describe('printStore', () => {
  it('опции по умолчанию: видимые строки, альбомная, A4', () => {
    expect(DEFAULT_PRINT_OPTIONS).toEqual({
      scope: 'visible',
      orientation: 'landscape',
      paper: 'a4',
    })
  })
})
