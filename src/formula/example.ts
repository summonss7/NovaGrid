/*
 * Живые примеры для справочника «?» (Этап 4.5): формула собирается по
 * реальным данным активного листа и вычисляется движком — пользователь
 * видит «=SUM(C2:C9) → 48 300» на своей таблице. Пустому листу служит
 * встроенная мини-таблица (детерминированная, как демо Этапа 1).
 */

import { getCell, parseNumber, type SheetModel } from '../core/sheet'
import { parseCellRef, refName } from './parser'
import { evalStandalone, formatNumber } from './engine'
import type { CellValue } from './types'
import { FormulaError } from './types'

export interface LiveExample {
  formula: string
  result: string
}

/** Встроенная мини-таблица для примеров, когда лист пуст. */
export function demoSheet(): SheetModel {
  const cells = new Map<string, string>()
  const put = (ref: string, v: string): void => {
    const r = parseCellRef(ref)!
    cells.set(`${r.row}:${r.col}`, v)
  }
  put('A1', 'Фамилия')
  put('B1', 'Отдел')
  put('C1', 'Сумма')
  const rows: readonly (readonly [string, string, number])[] = [
    ['Иванов', 'Продажи', 10000],
    ['Петров', 'Логистика', 12500],
    ['Сидоров', 'Продажи', 8000],
    ['Кузнецова', 'Бухгалтерия', 15300],
    ['Смирнов', 'Логистика', 4200],
    ['Волкова', 'Продажи', 9800],
  ]
  rows.forEach(([a, b, c], i) => {
    put(`A${i + 2}`, a)
    put(`B${i + 2}`, b)
    put(`C${i + 2}`, String(c))
  })
  return {
    cells,
    styles: new Map(),
    rows: 100,
    cols: 26,
    maxRow: rows.length,
    maxCol: 2,
  }
}

interface SheetColumns {
  /** колонка с числами (для агрегатов) */
  numeric: { col: number; r1: number; r2: number } | null
  /** колонка с текстом (для текстовых функций) */
  text: { col: number; row: number } | null
  /** колонка с повторяющимся текстом-критерием (SUMIF/COUNTIF) */
  key: { col: number; row: number; value: string } | null
}

function columnsOf(sheet: SheetModel): SheetColumns {
  const LIMIT = 16
  const last = Math.min(sheet.maxRow, LIMIT)
  if (last < 1) return { numeric: null, text: null, key: null }
  const numCounts = new Map<number, number>()
  const textFirst = new Map<number, string>()
  const counts = new Map<string, number>()
  const firstCounted = new Map<number, string>()
  for (let c = 0; c <= sheet.maxCol; c++) {
    for (let r = 1; r <= last; r++) {
      const raw = getCell(sheet, r, c)
      if (raw === '') continue
      if (parseNumber(raw) !== null) numCounts.set(c, (numCounts.get(c) ?? 0) + 1)
      else if (!textFirst.has(c)) textFirst.set(c, raw)
      if (r > 0) {
        counts.set(`${c}:${raw}`, (counts.get(`${c}:${raw}`) ?? 0) + 1)
        if (!firstCounted.has(c)) firstCounted.set(c, raw)
      }
    }
  }
  let numeric: SheetColumns['numeric'] = null
  let bestN = 0
  for (const [col, n] of numCounts)
    if (n > bestN) {
      bestN = n
      numeric = { col, r1: 1, r2: Math.min(last, Math.max(sheet.maxRow, 1)) }
    }
  let text: SheetColumns['text'] = null
  for (const [col, v] of textFirst) {
    text = { col, row: 1 }
    if (parseCellRef(v) === null && !/^\d+$/.test(v)) break
  }
  let key: SheetColumns['key'] = null
  let bestC = 0
  for (const [k, n] of counts) {
    const [cs, ...rest] = k.split(':')
    const value = rest.join(':')
    if (parseNumber(value) !== null) continue
    if (n > bestC && n >= 2) {
      bestC = n
      key = { col: Number(cs), row: 1, value }
    }
  }
  return { numeric, text, key }
}

/** Пример для функции по текущему листу (или мини-таблице, если он пуст). */
export function liveExample(sheet: SheetModel, fn: string): LiveExample {
  const empty = sheet.maxRow < 1
  const target = empty ? demoSheet() : sheet
  const cols = columnsOf(target)
  const numRange = cols.numeric
    ? `${refName(1, cols.numeric.col)}:${refName(Math.max(1, cols.numeric.r2), cols.numeric.col)}`
    : 'C2:C7'
  const numCell = cols.numeric ? refName(2, cols.numeric.col) : 'C2'
  const textCell = cols.text ? refName(cols.text.row, cols.text.col) : 'A2'
  const keyCol = cols.key ? cols.key.col : 0
  const keyRange = `${refName(1, keyCol)}:${refName(Math.max(1, target.maxRow), keyCol)}`
  const keyVal = cols.key ? cols.key.value : 'Иванов'

  const formulas: Record<string, string> = {
    SUM: `=SUM(${numRange})`,
    AVERAGE: `=AVERAGE(${numRange})`,
    COUNT: `=COUNT(${numRange})`,
    COUNTA: `=COUNTA(${numRange})`,
    MIN: `=MIN(${numRange})`,
    MAX: `=MAX(${numRange})`,
    ROUND: `=ROUND(${numCell};-3)`,
    ABS: `=ABS(-500)`,
    SUMIF: `=SUMIF(${keyRange};"${keyVal}";${numRange})`,
    SUMIFS: `=SUMIFS(${numRange};${keyRange};"${keyVal}";${numRange};">5000")`,
    AVERAGEIF: `=AVERAGEIF(${keyRange};"${keyVal}";${numRange})`,
    COUNTIF: `=COUNTIF(${keyRange};"${keyVal}")`,
    COUNTBLANK: `=COUNTBLANK(${numRange})`,
    IF: `=IF(${numCell}>10000;"крупная";"обычная")`,
    IFS: `=IFS(${numCell}>15000;"крупная";${numCell}>9000;"средняя";"малая")`,
    AND: `=AND(${numCell}>1000;${numCell}<100000)`,
    OR: `=OR(${numCell}=10000;${numCell}=12500)`,
    NOT: `=NOT(${numCell}>10000)`,
    CONCAT: `=CONCAT(${textCell};" — пример")`,
    CONCATENATE: `=CONCATENATE(${textCell};" — пример")`,
    LEFT: `=LEFT(${textCell};1)`,
    RIGHT: `=RIGHT(${textCell};2)`,
    MID: `=MID(${textCell};2;3)`,
    LEN: `=LEN(${textCell})`,
    TRIM: '=TRIM("  Иванов  ")',
    UPPER: `=UPPER(${textCell})`,
    LOWER: `=LOWER(${textCell})`,
    VLOOKUP: `=VLOOKUP("${keyVal}";${refName(2, keyCol)}:${refName(Math.max(2, target.maxRow), Math.max(keyCol + 2, 2))};3)`,
    DATE: '=DATE(2026;10;9)',
    TODAY: '=TODAY()',
    YEAR: '=YEAR(DATE(2026;10;9))',
    MONTH: '=MONTH(DATE(2026;10;9))',
    DAY: '=DAY(DATE(2026;10;9))',
  }
  const formula = formulas[fn] ?? `=${fn}(${numRange})`
  const v = evalStandalone(target, formula, 0, 0)
  return { formula, result: exampleText(v) }
}

function exampleText(v: CellValue): string {
  if (v instanceof FormulaError) return v.message
  if (v === null) return 'пусто'
  if (typeof v === 'number') return formatNumber(v)
  if (typeof v === 'boolean') return v ? 'ИСТИНА' : 'ЛОЖЬ'
  return v
}
