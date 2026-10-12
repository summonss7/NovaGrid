import { describe, expect, it } from 'vitest'
import { selectionText } from './copy'
import { createSheet, withCell, type SheetModel } from './sheet'
import { selectionOf } from './selection'

function sheetOf(cells: readonly (readonly string[])[]): SheetModel {
  let sh = createSheet()
  cells.forEach((row, r) => row.forEach((v, c) => (sh = withCell(sh, r, c, v))))
  return sh
}

describe('copy: текст выделения для буфера (novagrid-024)', () => {
  it('одна ячейка — её значение', () => {
    const sheet = sheetOf([
      ['Иванов', 'Продажи', '10000'],
      ['Петров', 'Логистика', '12500'],
    ])
    expect(selectionText(sheet, selectionOf(0, 2))).toBe('10000')
  })

  it('диапазон — табы между колонками, переводы строк между строками', () => {
    const sheet = sheetOf([
      ['Иванов', 'Продажи', '10000'],
      ['Петров', 'Логистика', '12500'],
    ])
    const sel = {
      active: { row: 0, col: 0 },
      ranges: [{ fr: 0, fc: 0, tr: 1, tc: 1 }],
    }
    expect(selectionText(sheet, sel)).toBe('Иванов\tПродажи\nПетров\tЛогистика')
  })

  it('несмежные области — общий прямоугольник охвата', () => {
    const sheet = sheetOf([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ])
    const sel = {
      active: { row: 0, col: 0 },
      ranges: [
        { fr: 0, fc: 0, tr: 0, tc: 0 },
        { fr: 1, fc: 2, tr: 1, tc: 2 },
      ],
    }
    expect(selectionText(sheet, sel)).toBe('a\tb\tc\nd\te\tf')
  })

  it('формула копируется вычисленным значением', () => {
    const sheet = sheetOf([['1', '2', '=A1+B1']])
    expect(selectionText(sheet, selectionOf(0, 2))).toBe('3')
  })

  it('пустые ячейки остаются пустыми между разделителями', () => {
    const sheet = sheetOf([
      ['a', '', 'c'],
      ['', '', ''],
    ])
    const sel = { active: { row: 0, col: 0 }, ranges: [{ fr: 0, fc: 0, tr: 1, tc: 2 }] }
    expect(selectionText(sheet, sel)).toBe('a\t\tc\n\t\t')
  })
})
