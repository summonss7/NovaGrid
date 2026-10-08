/*
 * Модель листа — чистый TS без DOM (ARCHITECTURE §6). Значения хранятся
 * сырыми строками в разреженной Map: пустых ячеек в памяти нет, поэтому
 * размер модели зависит только от заполненных ячеек, а не от габаритов
 * листа (важно для стресс-режима 100k×30 и будущих больших файлов).
 */

export type CellRaw = string

/** Логические габариты нового листа (как чистый лист Excel). */
export const MIN_ROWS = 100
export const MIN_COLS = 26

/**
 * Минимальный стиль ячейки, который честно переносится файл⇄модель (Этап 2):
 * жирность, выравнивание, заливка и цвет текста. Форматы чисел — Этап 4+.
 */
export interface CellStyle {
  bold?: boolean
  align?: 'left' | 'center' | 'right'
  /** заливка RRGGBB (без альфы и решётки) */
  bg?: string
  /** цвет текста RRGGBB */
  fg?: string
}

export interface SheetModel {
  /** ключ `${row}:${col}`, индексация с 0 */
  cells: Map<string, CellRaw>
  /** стили только заполненных ячеек — тем же ключом (переносятся из .xlsx) */
  styles: Map<string, CellStyle>
  /** логический размер листа (в пределах можно навигироваться) */
  rows: number
  cols: number
  /** границы контента — последняя тронутая ячейка (0-based, включительно) */
  maxRow: number
  maxCol: number
}

export function cellKey(row: number, col: number): string {
  return `${row}:${col}`
}

export function createSheet(rows = MIN_ROWS, cols = MIN_COLS): SheetModel {
  return { cells: new Map(), styles: new Map(), rows, cols, maxRow: -1, maxCol: -1 }
}

export function getCell(sheet: SheetModel, row: number, col: number): CellRaw {
  return sheet.cells.get(cellKey(row, col)) ?? ''
}

/**
 * Иммутабельная установка значения: новая Map (значения общие по ссылке).
 * Пустая строка удаляет ячейку из модели — «пусто» не хранится.
 */
export function withCell(sheet: SheetModel, row: number, col: number, value: CellRaw): SheetModel {
  const key = cellKey(row, col)
  const cells = new Map(sheet.cells)
  if (value === '') cells.delete(key)
  else cells.set(key, value)
  const touched = value !== ''
  return {
    cells,
    styles: sheet.styles,
    rows: Math.max(sheet.rows, row + 1),
    cols: Math.max(sheet.cols, col + 1),
    maxRow: touched ? Math.max(sheet.maxRow, row) : sheet.maxRow,
    maxCol: touched ? Math.max(sheet.maxCol, col) : sheet.maxCol,
  }
}

/**
 * Число из сырой строки: точка или запятая как десятичный разделитель
 * (русская локаль), без разделителей тысяч и валют — честный «простой»
 * разбор Этапа 1; формулы и богатые форматы появятся на Этапе 4.
 */
export function parseNumber(raw: CellRaw): number | null {
  const s = raw.trim()
  if (!/^[+-]?\d+([.,]\d+)?$/.test(s)) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export function getStyle(sheet: SheetModel, row: number, col: number): CellStyle | undefined {
  return sheet.styles.get(cellKey(row, col))
}

/** Иммутабельная установка стиля (аналог withCell). */
export function withStyle(
  sheet: SheetModel,
  row: number,
  col: number,
  style: CellStyle | undefined,
): SheetModel {
  const key = cellKey(row, col)
  const styles = new Map(sheet.styles)
  if (!style || Object.keys(style).length === 0) styles.delete(key)
  else styles.set(key, style)
  return { ...sheet, styles }
}

export function isNumericCell(sheet: SheetModel, row: number, col: number): boolean {
  return parseNumber(getCell(sheet, row, col)) !== null
}

/** Числовые значения ячеек листа (для метрик Σ/n/x̄). */
export function numericValuesOf(
  sheet: SheetModel,
  rows: readonly number[],
  cols: readonly number[],
): number[] {
  const out: number[] = []
  for (let i = 0; i < rows.length; i++) {
    const n = parseNumber(getCell(sheet, rows[i], cols[i]))
    if (n !== null) out.push(n)
  }
  return out
}
