/*
 * Текст выделения для буфера обмена (novagrid-024): прямоугольник охвата
 * всех областей, значения — вычисленные (те, что видит пользователь),
 * колонки через таб, строки через перевод строки — Excel-совместимый TSV,
 * вставляется и в электронные таблицы, и в обычный текст.
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
