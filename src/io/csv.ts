/*
 * CSV/TSV (Этап 2.1): детектор разделителя и кодировки, парсер и запись.
 * Чистый TS без DOM — работает и в IO-воркере, и в юнит-тестах Node.
 * Формула — RFC 4180: кавычки, ""-экранирование, переводы строк внутри поля.
 */

import { MIN_COLS, MIN_ROWS, type SheetModel, cellKey } from '../core/sheet'
import { cellText } from '../formula/engine'

export const CSV_DELIMITERS = [',', ';', '\t'] as const
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number]

/**
 * Кодировка: BOM (UTF-8/UTF-16) → строгий UTF-8 → Windows-1251 (русская
 * классика Excel) → мягкий UTF-8 с заменой. Детекция по содержимому, не по META.
 */
export function decodeBytes(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: new TextDecoder('utf-16le').decode(bytes.subarray(2)),
      encoding: 'utf-16le',
    }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      text: new TextDecoder('utf-16be').decode(bytes.subarray(2)),
      encoding: 'utf-16be',
    }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    // не UTF-8: русские CSV из Excel чаще всего в Windows-1251
    try {
      return {
        text: new TextDecoder('windows-1251').decode(bytes),
        encoding: 'windows-1251',
      }
    } catch {
      return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' }
    }
  }
}

/**
 * Разделитель по образцу начала файла: считаем кандидатов вне кавычек
 * на первых строках; .tsv форсирует таб.
 */
export function detectDelimiter(sample: string, ext: 'csv' | 'tsv' | string): CsvDelimiter {
  if (ext === 'tsv') return '\t'
  const lines = sample.split(/\r\n|\n|\r/, 50)
  const scores = new Map<string, number[]>()
  let inQuotes = false
  let lineIdx = 0
  for (const line of lines) {
    if (line.trim() === '') continue
    const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') inQuotes = !inQuotes
      else if (!inQuotes && ch in counts) counts[ch] += 1
    }
    if (inQuotes) inQuotes = false // кавычка не закрылась в строке образца — не гадаем
    for (const d of CSV_DELIMITERS) {
      const list = scores.get(d) ?? []
      list[lineIdx] = counts[d]
      scores.set(d, list)
    }
    lineIdx += 1
  }
  let best: CsvDelimiter = ','
  let bestScore = -1
  for (const d of CSV_DELIMITERS) {
    const list = scores.get(d) ?? []
    // разделитель должен встречаться в каждой строке примерно одинаково —
    // суммарная частота с бонусом за согласованность соседних строк
    const total = list.reduce((a, b) => a + b, 0)
    let consistency = 0
    for (let i = 1; i < list.length; i++)
      if (list[i] === list[i - 1] && list[i] > 0) consistency += 1
    const score = total + consistency * 2
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

/** Парсер RFC 4180: возвращает строки полей как есть (без типизации). */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const dlen = delimiter.length
  const n = text.length
  for (let i = 0; i < n; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else inQuotes = false
      } else field += ch
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (text.startsWith(delimiter, i) && dlen > 0) {
      row.push(field)
      field = ''
      i += dlen - 1
      continue
    }
    if (ch === '\r' || ch === '\n') {
      // CRLF считается одним переводом
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(field)
      field = ''
      // последняя пустая строка файла не становится строкой данных
      if (!(row.length === 1 && row[0] === '' && i + 1 >= n)) rows.push(row)
      row = []
      continue
    }
    field += ch
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** Разреженный лист из строк CSV: пустых ячеек в модели нет. */
export function sheetFromCsvRows(rows: readonly (readonly string[])[]): SheetModel {
  const cells = new Map<string, string>()
  let maxRow = -1
  let maxCol = -1
  rows.forEach((fields, r) =>
    fields.forEach((v, c) => {
      const value = v.trim() === '' ? '' : v
      if (value !== '') {
        cells.set(cellKey(r, c), value)
        maxRow = Math.max(maxRow, r)
        maxCol = Math.max(maxCol, c)
      }
    }),
  )
  return {
    cells,
    styles: new Map(),
    rows: Math.max(MIN_ROWS, rows.length),
    cols: Math.max(MIN_COLS, maxCol + 1, 1),
    maxRow,
    maxCol,
  }
}

/** Полный конвейер чтения CSV: байты → кодировка → разделитель → лист. */
export function csvToSheet(
  bytes: Uint8Array,
  ext: 'csv' | 'tsv' | string,
): { sheet: SheetModel; delimiter: string; encoding: string } {
  const { text, encoding } = decodeBytes(bytes)
  const delimiter = detectDelimiter(text, ext)
  return { sheet: sheetFromCsvRows(parseCsv(text, delimiter)), delimiter, encoding }
}

/** Экранирование поля по RFC 4180. */
function quoteField(value: string, delimiter: string): string {
  const d = delimiter === '\t' ? '\t' : delimiter
  if (
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r') ||
    value.includes(d) ||
    value !== value.trim()
  ) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

/**
 * Лист → CSV (CRLF + BOM: Excel открывает такой файл в UTF-8 без танцев).
 * Числа пишутся как есть (канонической строкой) — Excel распознаёт их числами.
 * Формулы пишутся вычисленным значением: CSV не хранит формулы.
 */
export function sheetToCsv(sheet: SheetModel, delimiter: string): string {
  const lines: string[] = []
  const lastRow = Math.max(sheet.maxRow, 0)
  const lastCol = Math.max(sheet.maxCol, 0)
  for (let r = 0; r <= lastRow; r++) {
    const fields: string[] = []
    for (let c = 0; c <= lastCol; c++) {
      fields.push(quoteField(cellText(sheet, r, c), delimiter))
    }
    lines.push(fields.join(delimiter))
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n'
}
