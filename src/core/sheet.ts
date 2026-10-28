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
 * Пределы листа — как у Excel .xlsx: выросший лист всегда честно экспортируется.
 */
export const MAX_ROWS = 1_048_576
export const MAX_COLS = 16_384

/**
 * Запас пустых строк/колонок за границей контента (novagrid-032): лист всегда
 * продолжается пустым местом вправо и вниз — есть куда вставить скопированный
 * блок. Прокрутка к краю запаса расширяет лист ещё (GridCanvas → growSheet).
 */
export const SPACE_ROWS = 50
export const SPACE_COLS = 10

/**
 * Минимальный стиль ячейки, который честно переносится файл⇄модель (Этап 2):
 * жирность, выравнивание, заливка и цвет текста. Форматы чисел — Этап 4+.
 * novagrid-039 добавляет начертания и шрифт: курсив, подчёркивание, гарнитура
 * (две self-hosted гарнитуры приложения) и размер в пунктах (pt) — как в Excel.
 */
export interface CellStyle {
  bold?: boolean
  /** курсив (novagrid-039) */
  italic?: boolean
  /** подчёркивание (novagrid-039) */
  underline?: boolean
  /** гарнитура: 'sans' — Open Sans (по умолчанию), 'display' — Montserrat */
  font?: 'sans' | 'display'
  /** размер шрифта в пунктах; undefined — стандартный размер грида */
  size?: number
  align?: 'left' | 'center' | 'right'
  /** заливка RRGGBB (без альфы и решётки) */
  bg?: string
  /** цвет текста RRGGBB */
  fg?: string
}

/** Пределы размера шрифта ячейки (pt): высота строки 30px вмещает до ~16pt. */
export const CELL_SIZE_MIN = 8
export const CELL_SIZE_MAX = 16

/** Нормализация размера из файла/пикера: кламп и шаг 0.5pt. */
export function normalizeCellSize(pt: number): number | undefined {
  if (!Number.isFinite(pt)) return undefined
  const clamped = Math.min(CELL_SIZE_MAX, Math.max(CELL_SIZE_MIN, pt))
  return Math.round(clamped * 2) / 2
}

export interface SheetModel {
  /** ключ `${row}:${col}`, индексация с 0 */
  cells: Map<string, CellRaw>
  /** стили только заполненных ячеек — тем же ключом (переносятся из .xlsx) */
  styles: Map<string, CellStyle>
  /**
   * Кэш значений чужих формул из файла (Этап 4.6): то, что вычислил Excel.
   * Показывается с индикатором «∛ не пересчитывается», если нашу функцию
   * движок не знает; поддерживаемые формулы считаются заново и кэш не нужен.
   */
  formulaCache?: Map<string, CellRaw>
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
    formulaCache: sheet.formulaCache,
    rows: Math.max(sheet.rows, row + 1),
    cols: Math.max(sheet.cols, col + 1),
    maxRow: touched ? Math.max(sheet.maxRow, row) : sheet.maxRow,
    maxCol: touched ? Math.max(sheet.maxCol, col) : sheet.maxCol,
  }
}

/**
 * Массовое применение списка правок одним клоном Map (novagrid-035): цепочка
 * withCell на каждую ячейку клонировала Map целиком — вставка/удаление
 * большого блока и их undo были O(n²) и замораживали интерфейс на минутах
 * (карточка novagrid-035). values — итоговые значения; семантика той же
 * цепочки: пустая строка удаляет ячейку, границы и maxRow/maxCol только
 * растут (заполненные ячейки), никогда не уменьшаются.
 */
export function withCellList(
  sheet: SheetModel,
  values: readonly { row: number; col: number; value: CellRaw }[],
): SheetModel {
  if (values.length === 0) return sheet
  const cells = new Map(sheet.cells)
  let { rows, cols, maxRow, maxCol } = sheet
  for (const ch of values) {
    const key = cellKey(ch.row, ch.col)
    if (ch.value === '') cells.delete(key)
    else {
      cells.set(key, ch.value)
      if (ch.row > maxRow) maxRow = ch.row
      if (ch.col > maxCol) maxCol = ch.col
    }
    if (ch.row + 1 > rows) rows = ch.row + 1
    if (ch.col + 1 > cols) cols = ch.col + 1
  }
  return {
    cells,
    styles: sheet.styles,
    formulaCache: sheet.formulaCache,
    rows,
    cols,
    maxRow,
    maxCol,
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

/**
 * Массовое применение стилей одним клоном Map (novagrid-039) — как withCellList
 * для значений: выделение колонки/строки красится за один проход, без O(n²)
 * клонирований. before/after — полные стили ячейки (undefined — стиля нет);
 * равные не пишутся, пустой after удаляет ключ.
 */
export function withStyleList(
  sheet: SheetModel,
  changes: readonly { row: number; col: number; before?: CellStyle; after?: CellStyle }[],
): SheetModel {
  if (changes.length === 0) return sheet
  const styles = new Map(sheet.styles)
  for (const ch of changes) {
    const key = cellKey(ch.row, ch.col)
    if (ch.after && Object.keys(ch.after).length > 0) styles.set(key, ch.after)
    else styles.delete(key)
  }
  return { ...sheet, styles }
}

/**
 * Слияние стиля ячейки с патчем (novagrid-039): ключи патча замещают поля,
 * undefined в патче снимает поле. Пустой итог → undefined (стиля нет).
 */
export function mergeCellStyle(
  base: CellStyle | undefined,
  patch: Partial<CellStyle>,
): CellStyle | undefined {
  const out = { ...base } as Partial<Record<keyof CellStyle, unknown>>
  for (const k of Object.keys(patch) as (keyof CellStyle)[]) {
    if (patch[k] === undefined) delete out[k]
    else out[k] = patch[k]
  }
  return Object.keys(out).length > 0 ? (out as CellStyle) : undefined
}

/**
 * Запас пустого места за контентом (novagrid-032): логические границы листа
 * всегда дальше последней тронутой ячейки на SPACE_ROWS/SPACE_COLS — за данными
 * видно пустые ячейки, куда можно вставить скопированный блок. Границы только
 * растут (как у withCell), экспорт не меняется: он идёт по maxRow/maxCol.
 */
export function withSpace(sheet: SheetModel): SheetModel {
  const rows = Math.min(MAX_ROWS, Math.max(sheet.rows, sheet.maxRow + 1 + SPACE_ROWS))
  const cols = Math.min(MAX_COLS, Math.max(sheet.cols, sheet.maxCol + 1 + SPACE_COLS))
  return rows === sheet.rows && cols === sheet.cols ? sheet : { ...sheet, rows, cols }
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
