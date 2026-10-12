import { describe, expect, it } from 'vitest'
import { parseClipboardTsv, selectionText } from './copy'
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

describe('paste: разбор TSV из буфера (novagrid-025)', () => {
  it('одна ячейка — одна строка одной колонки', () => {
    expect(parseClipboardTsv('10000')).toEqual([['10000']])
  })

  it('блок: строки по переводу, колонки по табу (CRLF, LF и CR)', () => {
    const expected = [
      ['Фамилия', 'Отдел', 'Сумма'],
      ['Иванов', 'Продажи', '10000'],
    ]
    expect(parseClipboardTsv('Фамилия\tОтдел\tСумма\r\nИванов\tПродажи\t10000')).toEqual(expected)
    expect(parseClipboardTsv('Фамилия\tОтдел\tСумма\nИванов\tПродажи\t10000')).toEqual(expected)
    expect(parseClipboardTsv('Фамилия\tОтдел\tСумма\rИванов\tПродажи\t10000')).toEqual(expected)
  })

  it('хвостовой перевод строки (Excel добавляет) не создаёт пустую строку', () => {
    expect(parseClipboardTsv('a\tb\n')).toEqual([['a', 'b']])
  })

  it('пустые ячейки между разделителями сохраняются', () => {
    expect(parseClipboardTsv('a\t\tc\n\t\t')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ])
  })

  it('Excel оборачивает кавычки/табы внутри ячейки — кавычки снимаются', () => {
    expect(parseClipboardTsv('"он сказал ""да"""\t2')).toEqual([['он сказал "да"', '2']])
  })

  it('кавычка в середине ячейки остаётся как есть', () => {
    expect(parseClipboardTsv('a"b')).toEqual([['a"b']])
  })

  it('пустой текст — пустой разбор', () => {
    expect(parseClipboardTsv('')).toEqual([])
  })
})
