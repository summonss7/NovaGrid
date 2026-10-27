/*
 * Текст выделения для буфера обмена (novagrid-024): прямоугольник охвата
 * всех областей, значения — вычисленные (те, что видит пользователь),
 * колонки через таб, строки через перевод строки — Excel-совместимый TSV,
 * вставляется и в электронные таблицы, и в обычный текст.
 *
 * parseClipboardTsv (novagrid-025) — обратный разбор для вставки Ctrl+V.
 *
 * novagrid-037: внутренний буфер — Ctrl+C дополнительно помнит сырые ячейки
 * (с формулами) и позицию источника. Вставка внутри NovaGrid, чей TSV-текст
 * совпал с последним копированием, переносит формулы со сдвигом относительных
 * ссылок, как Excel; чужой буфер (Excel, Таблицы) вставляется значениями.
 */

import { cellText } from '../formula/engine'
import { boundingBox, type Selection } from './selection'
import { getCell, type SheetModel } from './sheet'

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

/** Внутренняя копия Ctrl+C: сырые ячейки (с формулами) + угол источника. */
export interface InternalCopy {
  /** TSV вычисленных значений — ключ сопоставления с системным буфером */
  text: string
  grid: string[][]
  fr: number
  fc: number
}

let internalCopy: InternalCopy | null = null

/** Запомнить копию выделения (Ctrl+C / «Копировать» в меню ПКМ). */
export function rememberCopy(sheet: SheetModel, selection: Selection, text: string): void {
  const b = boundingBox(selection)
  const grid: string[][] = []
  for (let r = b.r1; r <= b.r2; r++) {
    const row: string[] = []
    for (let c = b.c1; c <= b.c2; c++) row.push(getCell(sheet, r, c))
    grid.push(row)
  }
  internalCopy = { text, grid, fr: b.r1, fc: b.c1 }
}

/**
 * Внутренняя копия для этого текста буфера: null — буфер чужой/устарел.
 * Совпадение по тексту значений: своё копирование даёт тот же TSV, что
 * лежит в системе; любой другой Ctrl+C текст меняет.
 */
export function takeInternalCopy(text: string): InternalCopy | null {
  return internalCopy !== null && internalCopy.text === text ? internalCopy : null
}

/** Прямоугольник листа для замощения блоком gridRows×gridCols. */
export interface TileRect {
  r1: number
  c1: number
  r2: number
  c2: number
}

/**
 * Куда встанет блок при вставке в одну область выделения (novagrid-037):
 * область крупнее блока и кратна ему → блок мостится по области (строка в
 * несколько выделенных строк — в каждую). Выделение всей строки не требует
 * кратности по колонкам (Excel кладёт блок с первой колонки), всей колонки —
 * по строкам; второе измерение у них берётся шириной блока. null — обычная
 * вставка от активной ячейки.
 */
export function tileRect(
  sel: { r1: number; c1: number; r2: number; c2: number },
  sheetRows: number,
  sheetCols: number,
  gridRows: number,
  gridCols: number,
): TileRect | null {
  const selRows = sel.r2 - sel.r1 + 1
  const selCols = sel.c2 - sel.c1 + 1
  const wholeRowSel = sel.c1 === 0 && sel.c2 >= sheetCols - 1
  const wholeColSel = sel.r1 === 0 && sel.r2 >= sheetRows - 1
  const fitRows = wholeColSel || selRows % gridRows === 0
  const fitCols = wholeRowSel || selCols % gridCols === 0
  if (!fitRows || !fitCols) return null
  if (selRows <= gridRows && selCols <= gridCols && !wholeRowSel && !wholeColSel) return null
  return {
    r1: sel.r1,
    c1: sel.c1,
    r2: wholeColSel || selRows === gridRows ? sel.r1 + gridRows - 1 : sel.r2,
    c2: wholeRowSel || selCols === gridCols ? sel.c1 + gridCols - 1 : sel.c2,
  }
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
