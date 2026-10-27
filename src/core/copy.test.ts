import { describe, expect, it } from 'vitest'
import { parseClipboardTsv, rememberCopy, selectionText, takeInternalCopy, tileRect } from './copy'
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

describe('внутренний буфер копирования (novagrid-037)', () => {
  it('rememberCopy помнит сырые ячейки с формулами, takeInternalCopy находит по TSV значений', () => {
    const sheet = sheetOf([['10', '=A1+1']])
    const sel = { active: { row: 0, col: 0 }, ranges: [{ fr: 0, fc: 0, tr: 0, tc: 1 }] }
    rememberCopy(sheet, sel, selectionText(sheet, sel))
    const internal = takeInternalCopy('10\t11')
    expect(internal).not.toBeNull()
    expect(internal!.grid).toEqual([['10', '=A1+1']])
    expect(internal!.fr).toBe(0)
    expect(internal!.fc).toBe(0)
    // чужой буфер (текст не совпал) — внутренняя копия не выдаётся
    expect(takeInternalCopy('другое')).toBeNull()
  })
})

describe('tileRect — мозаичная вставка (novagrid-037)', () => {
  it('область кратно больше блока мостится блоком', () => {
    // блок 1×2 в область 3×2 — блок повторится в каждой строке
    expect(tileRect({ r1: 5, c1: 0, r2: 7, c2: 1 }, 100, 26, 1, 2)).toEqual({
      r1: 5,
      c1: 0,
      r2: 7,
      c2: 1,
    })
    // блок 2×2 в область 6×4 — два повторения по строкам и колонкам
    expect(tileRect({ r1: 0, c1: 0, r2: 5, c2: 3 }, 100, 26, 2, 2)).toEqual({
      r1: 0,
      c1: 0,
      r2: 5,
      c2: 3,
    })
  })

  it('выделение всей строки не требует кратности колонок: ширина — блок', () => {
    // блок 1×3, выделены строки 5..7 целиком (26 колонок, 26 % 3 ≠ 0)
    expect(tileRect({ r1: 5, c1: 0, r2: 7, c2: 25 }, 100, 26, 1, 3)).toEqual({
      r1: 5,
      c1: 0,
      r2: 7,
      c2: 2,
    })
  })

  it('выделение всей колонки мостится по колонкам, высота — блок', () => {
    expect(tileRect({ r1: 0, c1: 2, r2: 99, c2: 4 }, 100, 26, 3, 1)).toEqual({
      r1: 0,
      c1: 2,
      r2: 2,
      c2: 4,
    })
  })

  it('область того же размера и некратная — обычная вставка (null)', () => {
    expect(tileRect({ r1: 0, c1: 0, r2: 1, c2: 1 }, 100, 26, 2, 2)).toBeNull()
    expect(tileRect({ r1: 0, c1: 0, r2: 4, c2: 1 }, 100, 26, 2, 2)).toBeNull()
    expect(tileRect({ r1: 0, c1: 0, r2: 1, c2: 2 }, 100, 26, 2, 2)).toBeNull()
  })
})
