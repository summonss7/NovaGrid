/*
 * Адаптер Excel (Этап 2.1/2.3, ARCHITECTURE §4): ExcelJS читает и пишет
 * .xlsx/.xlsm со стилями и формулами; SheetJS CE читает старый .xls (BIFF8);
 * .ods с novagrid-040 читает собственный парсер src/io/ods.ts (значения
 * + формулы + кэш результатов). Модуль исполняется в IO-воркере
 * и в юнит-тестах Node — без DOM.
 *
 * Ограничения v1 (сознательные, см. CONCEPT Ф1/Этап 4): формулы чужих файлов
 * с неподдержанными функциями читаются кэшем значений («∛»); макросы .xlsm
 * не сохраняются. novagrid-050: в .xlsx пишутся и читаются все атрибуты
 * листа — стили (начертания, шрифт/размер, цвета, выравнивание, перенос,
 * формат числа, границы), ширины колонок, закрепление и объединения;
 * .ods — собственный writer в ods.ts в пределах поддержки формата.
 */

import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'
import type { MergeRect } from '../core/merges'
import {
  BASE_COL_W,
  COL_W_MAX,
  COL_W_MIN,
} from '../grid/geometry'
import {
  normalizeCellSize,
  parseNumber,
  type CellBorders,
  type CellFormat,
  type CellStyle,
  cellKey,
} from '../core/sheet'
import { MIN_COLS, MIN_ROWS } from '../core/sheet'
import { formulaResultForSave, isFormulaRaw } from '../formula/engine'
import { sanitizeSheetName, uniqueTabName, type SheetWire } from '../core/workbook'

export { odsToSheets } from './ods'
export type { SheetWire } from '../core/workbook'

/* ── чтение .xlsx/.xlsm ─────────────────────────────────────────────── */

/** Значение ExcelJS → сырая строка модели (формулы — кэш результата). */
function cellValueToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'ИСТИНА' : 'ЛОЖЬ'
  if (value instanceof Date) {
    const date = value.toISOString().slice(0, 10)
    const time = value.toISOString().slice(11, 16)
    return time === '00:00' ? date : `${date} ${time}`
  }
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    if ('richText' in v && Array.isArray(v.richText)) {
      return v.richText.map((rt) => String((rt as { text?: string }).text ?? '')).join('')
    }
    // { formula | sharedFormula, result } — показываем вычисленное значение
    if ('formula' in v || 'sharedFormula' in v) {
      return cellValueToString('result' in v ? v.result : null)
    }
    if ('hyperlink' in v && 'text' in v) return String(v.text)
    if ('error' in v) return String(v.error)
    if ('text' in v) return String(v.text)
  }
  return String(value)
}

/** ARGB ExcelJS ('FF2BA84A' | 'FF2BA84A00') → 'RRGGBB'; theme-цвета не тянем. */
function argbToHex(color: { argb?: string } | undefined): string | undefined {
  const argb = color?.argb
  if (!argb || !/^[0-9a-fA-F]{8}$/.test(argb)) return undefined
  const hex = argb.slice(2).toUpperCase()
  return hex === '000000' ? undefined : hex
}

/** «A1» (как в mergeCells .xlsx) → индексы с 0; null — неразборчивый адрес. */
function a1ToRC(ref: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(ref.trim())
  if (!m) return null
  let c = 0
  for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64)
  const r = Number(m[2]) - 1
  return c >= 1 && r >= 0 && c <= 16384 && r <= 1_048_575 ? { r, c: c - 1 } : null
}

/**
 * mergeCells листа (novagrid-047): «A1:B2» → прямоугольники; скрытые ячейки
 * объединений очищаются от значений — модель хранит только левый верхний.
 */
function mergesOf(ws: ExcelJS.Worksheet, cells: Map<string, string>): MergeRect[] {
  const out: MergeRect[] = []
  const refs = ws.model.merges ?? []
  for (const ref of refs) {
    const [a, b = a] = String(ref).split(':')
    const p1 = a1ToRC(a)
    const p2 = a1ToRC(b)
    if (!p1 || !p2) continue
    const rect = {
      r1: Math.min(p1.r, p2.r),
      c1: Math.min(p1.c, p2.c),
      r2: Math.max(p1.r, p2.r),
      c2: Math.max(p1.c, p2.c),
    }
    if (rect.r1 === rect.r2 && rect.c1 === rect.c2) continue
    out.push(rect)
    for (let r = rect.r1; r <= rect.r2; r++)
      for (let c = rect.c1; c <= rect.c2; c++)
        if (r !== rect.r1 || c !== rect.c1) cells.delete(cellKey(r, c))
  }
  return out
}

/** Есть ли у стороны границы стиль (тонкая линия — novagrid-049/050). */
function borderSide(style: Partial<ExcelJS.Border> | undefined): boolean {
  return !!style && style.style !== undefined
}

/**
 * Формат числа .xlsx → CellFormat (novagrid-050/051): свой или чужой по эвристике.
 * Порядок важен: валюта проверяется до числового, иначе «#,##0.00 $» уйдёт
 * в Числовой по группировке разрядов. Неизвестное — undefined = Общий.
 */
export function numFmtToFormat(fmt: string | undefined): CellFormat | undefined {
  if (!fmt || fmt === 'General') return undefined
  // ru-локали пишут группу разрядов неразрывным пробелом — нормируем
  const low = fmt.toLowerCase().replace(/\u00a0/g, ' ')
  if (
    fmt.includes('₽') ||
    fmt.includes('$') ||
    fmt.includes('€') ||
    low.includes('руб') ||
    low.includes('"р"') ||
    low.includes('rub') ||
    low.includes('[$')
  )
    return 'money'
  if (low.includes('%')) return 'percent'
  // '#,##0*' → Числовой: группировка через запятую или пробел
  if (/#,##0|# ##0/.test(low)) return 'number'
  return undefined
}

/** CellFormat → строка numFmt .xlsx (запись, novagrid-050). */
export function formatToNumFmt(fmt: CellFormat): string {
  if (fmt === 'percent') return '0.00%'
  if (fmt === 'money') return '#,##0.00" ₽"'
  return '#,##0.00'
}

/** Ширина колонки ExcelJS (символы) → базовые единицы грида (px, зум 100 %). */
export function excelWidthToPx(width: number): number | undefined {
  if (!Number.isFinite(width) || width <= 0) return undefined
  const px = Math.round(width * 7 + 5)
  const clamped = Math.min(COL_W_MAX, Math.max(COL_W_MIN, px))
  return clamped === BASE_COL_W ? undefined : clamped
}

/** Базовые единицы грида (px) → ширина колонки ExcelJS (символы). */
export function pxToExcelWidth(px: number): number {
  return Math.max(1, Math.round(((px - 5) / 7) * 100) / 100)
}

function cellStyleOf(cell: ExcelJS.Cell): CellStyle | undefined {
  const style: CellStyle = {}
  if (cell.font?.bold) style.bold = true
  // начертания и шрифт (novagrid-039): размер берём только явный — ячейки
  // без своего размера наследуют стандарт грида, а не «11 по умолчанию»
  if (cell.font?.italic) style.italic = true
  if (cell.font?.underline) style.underline = true
  // размер берём только явный: ячейка с одним выравниванием/переносом получает
  // от ExcelJS дефолтный шрифт книги (Calibri 11, цвет — theme) — это не
  // «размер ячейки»; свой размер наш writer пишет без name/цвета
  const fontColor = cell.font?.color as { argb?: string; theme?: number } | undefined
  const isDefaultFont =
    cell.font?.name === 'Calibri' &&
    cell.font?.size === 11 &&
    !cell.font?.bold &&
    !cell.font?.italic &&
    !cell.font?.underline &&
    fontColor?.argb === undefined
  if (typeof cell.font?.size === 'number' && !isDefaultFont) {
    const pt = normalizeCellSize(cell.font.size)
    if (pt !== undefined) style.size = pt
  }
  if (cell.font?.name === 'Montserrat') style.font = 'display'
  const h = cell.alignment?.horizontal
  if (h === 'left' || h === 'center' || h === 'right') style.align = h
  if (cell.alignment?.wrapText) style.wrap = true
  if (cell.fill && (cell.fill as { type?: string }).type === 'pattern') {
    const pattern = cell.fill as { pattern?: string; fgColor?: { argb?: string } }
    if (pattern.pattern === 'solid') {
      const bg = argbToHex(pattern.fgColor)
      if (bg && bg !== 'FFFFFF') style.bg = bg
    }
  }
  const fg = argbToHex(cell.font?.color)
  if (fg && fg !== '000000') style.fg = fg
  const fmt = numFmtToFormat(cell.numFmt)
  if (fmt) style.fmt = fmt
  // границы (novagrid-049/050): любая ненулевая сторона файла — тонкая линия
  const b = cell.border
  if (b) {
    const borders: CellBorders = {
      ...(borderSide(b.top) ? { top: true } : {}),
      ...(borderSide(b.right) ? { right: true } : {}),
      ...(borderSide(b.bottom) ? { bottom: true } : {}),
      ...(borderSide(b.left) ? { left: true } : {}),
    }
    if (Object.keys(borders).length > 0) style.borders = borders
  }
  return Object.keys(style).length > 0 ? style : undefined
}

/** Закрепление листа .xlsx: первый frozen view → {rows, cols} (0 — нет). */
function freezeOf(ws: ExcelJS.Worksheet): { rows: number; cols: number } | undefined {
  const view = (ws.views ?? []).find((v) => (v as { state?: string }).state === 'frozen') as
    | { xSplit?: number; ySplit?: number }
    | undefined
  if (!view) return undefined
  const rows = Math.max(0, Math.floor(view.ySplit ?? 0))
  const cols = Math.max(0, Math.floor(view.xSplit ?? 0))
  return rows > 0 || cols > 0 ? { rows, cols } : undefined
}

/** Ширины колонок .xlsx: только переопределённые (index → базовые единицы). */
function colWidthsOf(ws: ExcelJS.Worksheet): Map<number, number> | undefined {
  const out = new Map<number, number>()
  // ws.columns отдаёт только определённые в файле колонки (1-based)
  const cols = (ws.columns ?? []) as (ExcelJS.Column | undefined)[]
  cols.forEach((col, i) => {
    const width = col?.width
    if (typeof width !== 'number' || i >= 1024) return
    const px = excelWidthToPx(width)
    if (px !== undefined) out.set(i, px)
  })
  return out.size > 0 ? out : undefined
}

export async function xlsxToSheets(buffer: ArrayBuffer): Promise<SheetWire[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const out: SheetWire[] = []
  const used = new Set<string>()
  for (const ws of wb.worksheets) {
    let name = sanitizeSheetName(ws.name)
    if (!name) name = `Лист ${out.length + 1}`
    if (used.has(name)) name = uniqueTabName([...used], name)
    used.add(name)

    const cells = new Map<string, string>()
    const styles = new Map<string, CellStyle>()
    // кэш результатов формул — для тех, что наш движок не считает (∛, Ф6)
    let formulaCache: Map<string, string> | undefined
    let maxRow = -1
    let maxCol = -1
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      // includeEmpty (novagrid-050): стили бывают и у пустых ячеек (заливка/
      // границы «на вырост») — значение всё равно хранится только непустое
      row.eachCell({ includeEmpty: true }, (cell, cn) => {
        const key = cellKey(rn - 1, cn - 1)
        const v = cell.value
        let raw: string
        if (
          v &&
          typeof v === 'object' &&
          !Array.isArray(v) &&
          ('formula' in v || 'sharedFormula' in v)
        ) {
          // формула: текст — в модель, результат Excel — в кэш; поддерживаемые
          // функции посчитаются заново, остальные покажут кэш с меткой ∛
          const fv = v as { formula?: string; sharedFormula?: string; result?: unknown }
          let formula = fv.formula
          if (!formula && typeof fv.sharedFormula === 'string') {
            try {
              const master = ws.getCell(fv.sharedFormula).value as { formula?: string } | undefined
              if (master && typeof master === 'object' && typeof master.formula === 'string')
                formula = master.formula
            } catch {
              // кривой адрес ведущей ячейки — остаёмся на кэше значения
            }
          }
          const cached = cellValueToString(fv.result)
          raw = formula ? `=${formula}` : cached
          if (formula && cached !== '') {
            formulaCache ??= new Map<string, string>()
            formulaCache.set(key, cached)
          }
        } else {
          raw = cellValueToString(v)
        }
        if (raw !== '') {
          cells.set(key, raw)
          maxRow = Math.max(maxRow, rn - 1)
          maxCol = Math.max(maxCol, cn - 1)
        }
        const style = cellStyleOf(cell)
        if (style) styles.set(key, style)
      })
    })
    const merges = mergesOf(ws, cells)
    const colWidths = colWidthsOf(ws)
    const freeze = freezeOf(ws)
    out.push({
      name,
      sheet: {
        cells,
        styles,
        ...(merges.length > 0 ? { merges } : {}),
        ...(formulaCache ? { formulaCache } : {}),
        rows: Math.max(MIN_ROWS, maxRow + 1),
        cols: Math.max(MIN_COLS, maxCol + 1),
        maxRow,
        maxCol,
      },
      ...(colWidths ? { colWidths } : {}),
      ...(freeze ? { freeze } : {}),
    })
  }
  return out
}

/* ── чтение .xls (SheetJS CE, значения; стили не переносятся) ─────────── */

/** Значение AOA SheetJS → сырая строка модели (даты — ISO, как у .xlsx). */
function aoaValueToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    const date = value.toISOString().slice(0, 10)
    const time = value.toISOString().slice(11, 16)
    return time === '00:00' ? date : `${date} ${time}`
  }
  if (typeof value === 'boolean') return value ? 'ИСТИНА' : 'ЛОЖЬ'
  return String(value).trim()
}

function sheetsFromSheetJs(wb: XLSX.WorkBook, raw: boolean): SheetWire[] {
  const out: SheetWire[] = []
  const used = new Set<string>()
  for (const wsName of wb.SheetNames) {
    const ws = wb.Sheets[wsName]
    if (!ws) continue
    let name = sanitizeSheetName(wsName)
    if (!name) name = `Лист ${out.length + 1}`
    if (used.has(name)) name = uniqueTabName([...used], name)
    used.add(name)

    // raw:false — форматированные строки «как отображаются» (.xls);
    // raw:true — сами значения (числа, даты-Date у .ods через cellDates)
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw,
      defval: '',
      // пустые строки сохраняют позиции: blankrows:false сдвигал данные вверх
      // при пустых строках внутри листа (novagrid-040)
      blankrows: true,
    })
    const cells = new Map<string, string>()
    let maxRow = -1
    let maxCol = -1
    aoa.forEach((fields, r) =>
      (fields ?? []).forEach((v, c) => {
        const value = raw ? aoaValueToString(v) : String(v ?? '').trim()
        if (value !== '') {
          cells.set(cellKey(r, c), value)
          maxRow = Math.max(maxRow, r)
          maxCol = Math.max(maxCol, c)
        }
      }),
    )
    // объединённые ячейки .xls (novagrid-047): SheetJS отдаёт их диапазонами
    const merges: MergeRect[] = []
    for (const mr of ws['!merges'] ?? []) {
      if (!mr || typeof mr !== 'object') continue
      const rect = {
        r1: Math.min(mr.s.r, mr.e.r),
        c1: Math.min(mr.s.c, mr.e.c),
        r2: Math.max(mr.s.r, mr.e.r),
        c2: Math.max(mr.s.c, mr.e.c),
      }
      if (rect.r1 === rect.r2 && rect.c1 === rect.c2) continue
      merges.push(rect)
      for (let r = rect.r1; r <= rect.r2; r++)
        for (let c = rect.c1; c <= rect.c2; c++)
          if (r !== rect.r1 || c !== rect.c1) cells.delete(cellKey(r, c))
    }
    out.push({
      name,
      sheet: {
        cells,
        styles: new Map(),
        ...(merges.length > 0 ? { merges } : {}),
        rows: Math.max(MIN_ROWS, maxRow + 1),
        cols: Math.max(MIN_COLS, maxCol + 1),
        maxRow,
        maxCol,
      },
    })
  }
  return out
}

export function xlsToSheets(buffer: ArrayBuffer): SheetWire[] {
  return sheetsFromSheetJs(XLSX.read(buffer, { type: 'array' }), false)
}

/* .ods читает собственный парсер src/io/ods.ts — значения + формулы
 * (novagrid-040); odsToSheets реэкспортируется выше. */

/* ── запись .xlsx со стилями ────────────────────────────────────────── */

/** exceljs в браузере отдаёт Buffer-view; для postMessage/Blob нужен чистый ArrayBuffer. */
function toArrayBuffer(out: unknown): ArrayBuffer {
  if (out instanceof ArrayBuffer) return out
  if (ArrayBuffer.isView(out)) return (out as Uint8Array).slice().buffer
  throw new Error('Неожиданный тип буфера ExcelJS')
}

export async function sheetsToXlsx(sheets: readonly SheetWire[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  const used = new Set<string>()
  for (const { name, sheet, colWidths, freeze } of sheets) {
    let wsName = sanitizeSheetName(name) || `Лист ${used.size + 1}`
    if (used.has(wsName)) wsName = uniqueTabName([...used], wsName)
    used.add(wsName)
    const ws = wb.addWorksheet(wsName)

    const lastRow = Math.max(sheet.maxRow, 0)
    const lastCol = Math.max(sheet.maxCol, 0)
    // стили и объединения бывают и за контентом (границы/заливка «на вырост»,
    // объединение пустых ячеек) — границы записи идут по ним тоже
    let extentRow = lastRow
    let extentCol = lastCol
    for (const key of sheet.styles.keys()) {
      const sep = key.indexOf(':')
      const r = Number(key.slice(0, sep))
      const c = Number(key.slice(sep + 1))
      if (r > extentRow) extentRow = r
      if (c > extentCol) extentCol = c
    }
    for (const m of sheet.merges ?? []) {
      if (m.r2 > extentRow) extentRow = m.r2
      if (m.c2 > extentCol) extentCol = m.c2
    }
    // матрица значений: числа — числами, пусто — null (не пустая строка);
    // формулы — null в матрице (записываются ниже объектом {formula, result})
    const matrix: (string | number | null)[][] = []
    const formulaCells: { r: number; c: number }[] = []
    for (let r = 0; r <= lastRow; r++) {
      const row: (string | number | null)[] = []
      for (let c = 0; c <= lastCol; c++) {
        const raw = sheet.cells.get(cellKey(r, c)) ?? ''
        if (isFormulaRaw(raw)) {
          formulaCells.push({ r, c })
          row.push(null)
          continue
        }
        const num = parseNumber(raw)
        row.push(raw === '' ? null : num !== null ? num : raw)
      }
      matrix.push(row)
    }
    ws.addRows(matrix)

    // объединения — ДО стилей (novagrid-050): mergeCells стирает стили
    // покрываемых ячеек, а стиль после объединения ложится и на скрытые
    // координаты (границы периметра объединения — именно на них)
    for (const m of sheet.merges ?? []) {
      if (m.r2 > extentRow || m.c2 > extentCol) continue
      try {
        ws.mergeCells(m.r1 + 1, m.c1 + 1, m.r2 + 1, m.c2 + 1)
      } catch {
        // перекрывающиеся области в модели — пропускаем, файл остаётся валидным
      }
    }

    // формулы: канонический текст («,» между аргументами) + вычисленный
    // результат; чужие (∛) сохраняются как есть со значением из файла
    for (const fc of formulaCells) {
      const cell = ws.getCell(fc.r + 1, fc.c + 1)
      const { result, canonical } = formulaResultForSave(sheet, fc.r, fc.c)
      const raw = sheet.cells.get(cellKey(fc.r, fc.c)) ?? '='
      cell.value = { formula: canonical ?? raw.slice(1), result }
    }

    // стили применяются координатно после значений; ячейка без значения,
    // но со стилем (заливка/границы «на вырост») тоже записывается
    for (const [key, style] of sheet.styles) {
      const [r, c] = key.split(':').map(Number)
      if (!(r >= 0 && r <= extentRow && c >= 0 && c <= extentCol)) continue
      const cell = ws.getCell(r + 1, c + 1)
      if (
        style.bold ||
        style.italic ||
        style.underline ||
        style.fg ||
        style.size !== undefined ||
        style.font !== undefined
      ) {
        cell.font = {
          ...(style.bold ? { bold: true } : {}),
          ...(style.italic ? { italic: true } : {}),
          ...(style.underline ? { underline: true } : {}),
          ...(style.size !== undefined ? { size: style.size } : {}),
          ...(style.font === 'display' ? { name: 'Montserrat' } : {}),
          ...(style.fg ? { color: { argb: `FF${style.fg}` } } : {}),
        }
      }
      if (style.align || style.wrap) {
        cell.alignment = {
          ...(style.align ? { horizontal: style.align } : {}),
          ...(style.wrap ? { wrapText: true } : {}),
        }
      }
      if (style.bg)
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${style.bg}` } }
      if (style.fmt) cell.numFmt = formatToNumFmt(style.fmt)
      if (style.borders) {
        const thin = { style: 'thin' as const }
        cell.border = {
          ...(style.borders.top ? { top: thin } : {}),
          ...(style.borders.right ? { right: thin } : {}),
          ...(style.borders.bottom ? { bottom: thin } : {}),
          ...(style.borders.left ? { left: thin } : {}),
        }
      }
    }

    // ширины колонок и закрепление (novagrid-050)
    if (colWidths) {
      for (const [c, w] of colWidths) {
        if (c >= 0 && c < 16384) ws.getColumn(c + 1).width = pxToExcelWidth(w)
      }
    }
    if (freeze && (freeze.rows > 0 || freeze.cols > 0)) {
      ws.views = [
        {
          state: 'frozen',
          ...(freeze.cols > 0 ? { xSplit: freeze.cols } : {}),
          ...(freeze.rows > 0 ? { ySplit: freeze.rows } : {}),
        },
      ]
    }
  }
  const out = await wb.xlsx.writeBuffer()
  return toArrayBuffer(out)
}
