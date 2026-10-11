/*
 * Адаптер Excel (Этап 2.1/2.3, ARCHITECTURE §4): ExcelJS читает и пишет
 * .xlsx/.xlsm со стилями; SheetJS CE читает старый .xls (BIFF8) и .ods
 * (Этап 7.3 — значения, без стилей). Модуль исполняется в IO-воркере
 * и в юнит-тестах Node — без DOM.
 *
 * Ограничения v1 (сознательные, см. CONCEPT Ф1/Этап 4): формулы чужих файлов
 * читаются кэшем значений (пересчёт — свой движок на Этапе 4); макросы .xlsm
 * не сохраняются; объединённые ячейки читаются как значение левой ячейки;
 * стили переносятся только для .xlsx; .ods читается значениями и не пишется
 * (прямой записи .ods нет — «Сохранить как .xlsx/.csv»).
 */

import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'
import { parseNumber, type CellStyle, type SheetModel, cellKey } from '../core/sheet'
import { MIN_COLS, MIN_ROWS } from '../core/sheet'
import { formulaResultForSave, isFormulaRaw } from '../formula/engine'
import { sanitizeSheetName, uniqueTabName } from '../core/workbook'

export interface SheetWire {
  name: string
  sheet: SheetModel
}

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

function cellStyleOf(cell: ExcelJS.Cell): CellStyle | undefined {
  const style: CellStyle = {}
  if (cell.font?.bold) style.bold = true
  const h = cell.alignment?.horizontal
  if (h === 'left' || h === 'center' || h === 'right') style.align = h
  if (cell.fill && (cell.fill as { type?: string }).type === 'pattern') {
    const pattern = cell.fill as { pattern?: string; fgColor?: { argb?: string } }
    if (pattern.pattern === 'solid') {
      const bg = argbToHex(pattern.fgColor)
      if (bg && bg !== 'FFFFFF') style.bg = bg
    }
  }
  const fg = argbToHex(cell.font?.color)
  if (fg && fg !== '000000') style.fg = fg
  return Object.keys(style).length > 0 ? style : undefined
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
      row.eachCell({ includeEmpty: false }, (cell, cn) => {
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
              const master = ws.getCell(fv.sharedFormula).value as
                | { formula?: string }
                | undefined
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
        if (style && raw !== '') styles.set(key, style)
      })
    })
    out.push({
      name,
      sheet: {
        cells,
        styles,
        ...(formulaCache ? { formulaCache } : {}),
        rows: Math.max(MIN_ROWS, maxRow + 1),
        cols: Math.max(MIN_COLS, maxCol + 1),
        maxRow,
        maxCol,
      },
    })
  }
  return out
}

/* ── чтение .xls/.ods (SheetJS CE, значения; стили не переносятся) ────── */

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
      blankrows: false,
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
    out.push({
      name,
      sheet: {
        cells,
        styles: new Map(),
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

/** ODS: значения; даты — Date (cellDates) → ISO. Стили ODS не читаются. */
export function odsToSheets(buffer: ArrayBuffer): SheetWire[] {
  return sheetsFromSheetJs(XLSX.read(buffer, { type: 'array', cellDates: true }), true)
}

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
  for (const { name, sheet } of sheets) {
    let wsName = sanitizeSheetName(name) || `Лист ${used.size + 1}`
    if (used.has(wsName)) wsName = uniqueTabName([...used], wsName)
    used.add(wsName)
    const ws = wb.addWorksheet(wsName)

    const lastRow = Math.max(sheet.maxRow, 0)
    const lastCol = Math.max(sheet.maxCol, 0)
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

    // формулы: канонический текст («,» между аргументами) + вычисленный
    // результат; чужие (∛) сохраняются как есть со значением из файла
    for (const fc of formulaCells) {
      const cell = ws.getCell(fc.r + 1, fc.c + 1)
      const { result, canonical } = formulaResultForSave(sheet, fc.r, fc.c)
      const raw = sheet.cells.get(cellKey(fc.r, fc.c)) ?? '='
      cell.value = { formula: canonical ?? raw.slice(1), result }
    }

    // стили применяются координатно после значений
    for (const [key, style] of sheet.styles) {
      const [r, c] = key.split(':').map(Number)
      if (!(r >= 0 && r <= lastRow && c >= 0 && c <= lastCol)) continue
      const cell = ws.getCell(r + 1, c + 1)
      if (style.bold || style.fg) {
        cell.font = {
          ...(style.bold ? { bold: true } : {}),
          ...(style.fg ? { color: { argb: `FF${style.fg}` } } : {}),
        }
      }
      if (style.align) cell.alignment = { horizontal: style.align }
      if (style.bg)
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${style.bg}` } }
    }
  }
  const out = await wb.xlsx.writeBuffer()
  return toArrayBuffer(out)
}
