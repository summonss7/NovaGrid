/*
 * Текст выделения для буфера обмена (novagrid-024): прямоугольник охвата
 * всех областей, значения — вычисленные (те, что видит пользователь),
 * колонки через таб, строки через перевод строки — Excel-совместимый TSV,
 * вставляется и в электронные таблицы, и в обычный текст.
 *
 * parseClipboardTsv (novagrid-025) — обратный разбор для вставки Ctrl+V.
 */

import { cellText } from '../formula/engine'
import { boundingBox, type Selection } from './selection'
import type { SheetModel } from './sheet'

export function selectionText(sheet: SheetModel, selection: Selection): string {
  const b = boundingBox(selection)
  const lines: string[] = []
  for (let r = b.r1; r <= b.r2; r++) {
    const cols: string[] = []
    for (let c = b.c1; c <= b.c2; c++) cols.push(cellText(sheet, r, c))
    lines.push(cols.join('\t'))
  }
  return lines.join('\n')
}

/**
 * Разбор TSV из буфера обмена (novagrid-025): строки по переводам строки
 * (\r\n / \n / \r), колонки по табу — формат, который кладут Excel, Таблицы
 * и сам Ctrl+C NovaGrid. Ячейки с табами/переводами/кавычками Excel обёртывает
 * в кавычки с удвоением внутренних — конечный автомат снимает их. Перевод
 * строки в конце (Excel кладёт его после последней строки) пустой строки
 * не создаёт.
 */
export function parseClipboardTsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  const pushCell = () => {
    row.push(cell)
    cell = ''
  }
  const pushRow = () => {
    pushCell()
    rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else inQuotes = false
      } else cell += ch
      continue
    }
    if (cell === '' && ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === '\t') {
      pushCell()
      continue
    }
    if (ch === '\n' || ch === '\r') {
      pushRow()
      if (ch === '\r' && text[i + 1] === '\n') i++
      continue
    }
    cell += ch
  }
  // хвост без перевода строки — тоже строка; одинокий перевод в конце — нет
  if (cell !== '' || row.length > 0) pushRow()
  return rows
}
