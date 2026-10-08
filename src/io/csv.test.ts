import { describe, expect, it } from 'vitest'
import { cellKey, createSheet, getCell, withCell } from '../core/sheet'
import { csvToSheet, decodeBytes, detectDelimiter, parseCsv, sheetToCsv } from './csv'

const enc = (s: string) => new TextEncoder().encode(s)

describe('csv: детектор кодировки', () => {
  it('UTF-8 с BOM и без BOM', () => {
    expect(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...enc('Иванов')])).encoding).toBe('utf-8')
    expect(decodeBytes(enc('Иванов,Петров')).encoding).toBe('utf-8')
    expect(decodeBytes(enc('Иванов,Петров')).text).toBe('Иванов,Петров')
  })

  it('UTF-16 LE/BE по BOM', () => {
    // «А» = U+0410 → LE: 10 04; BE: 04 10
    const le = decodeBytes(new Uint8Array([0xff, 0xfe, 0x10, 0x04]))
    expect(le.encoding).toBe('utf-16le')
    expect(le.text).toBe('А')
  })

  const cp1251ok = (() => {
    try {
      return new TextDecoder('windows-1251').decode(enc('x')) !== undefined
    } catch {
      return false
    }
  })()

  it.skipIf(!cp1251ok)('невалидный UTF-8 трактуется как Windows-1251 (русский Excel)', () => {
    // «Иванов» в cp1251: И=C8, в=B2, а=E0...
    const cp = new Uint8Array([0xc8, 0xe2, 0xe0, 0xed, 0xee, 0xe2])
    const res = decodeBytes(cp)
    expect(res.encoding).toBe('windows-1251')
    expect(res.text).toBe('Иванов')
  })
})

describe('csv: детектор разделителя', () => {
  it('точка с запятой против запятой — по частоте вне кавычек', () => {
    expect(detectDelimiter('a;b;c\n1;2;3\n4;5;6', 'csv')).toBe(';')
    expect(detectDelimiter('a,b,c\n1,2,3', 'csv')).toBe(',')
  })

  it('разделитель внутри кавычек не считается', () => {
    expect(detectDelimiter('"a;b";c\n"1;2";3', 'csv')).toBe(';') // вне кавычек ; по одному
    expect(detectDelimiter('"a,b";c;1\n"1,2";d;2', 'csv')).toBe(';')
  })

  it('tsv форсирует табуляцию', () => {
    expect(detectDelimiter('a,b\tc', 'tsv')).toBe('\t')
  })

  it('без кандидатов — запятая по умолчанию', () => {
    expect(detectDelimiter('один столбец', 'csv')).toBe(',')
  })
})

describe('csv: парсер RFC 4180', () => {
  it('простые строки, CRLF и последняя пустая строка', () => {
    const rows = parseCsv('a,b\r\nc,d\r\n', ',')
    expect(rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('кавычки: экранирование «""», запятая и перевод строки внутри поля', () => {
    const rows = parseCsv('"до,""после""",x\n"много\nстрок",y', ',')
    expect(rows).toEqual([
      ['до,"после"', 'x'],
      ['много\nстрок', 'y'],
    ])
  })

  it('пустые поля сохраняются как позиции', () => {
    const rows = parseCsv('a,,c', ',')
    expect(rows).toEqual([['a', '', 'c']])
  })
})

describe('csv: конвейер байты → лист', () => {
  it('csvToSheet строит разреженную модель и возвращает разделитель', () => {
    const { sheet, delimiter, encoding } = csvToSheet(enc('Фамилия;Сумма\nИванов;10000'), 'csv')
    expect(delimiter).toBe(';')
    expect(encoding).toBe('utf-8')
    expect(getCell(sheet, 0, 0)).toBe('Фамилия')
    expect(getCell(sheet, 1, 1)).toBe('10000')
    expect(sheet.cells.size).toBe(4)
  })

  it('лист с таблицей 1000×6 парсится без потерь углов', () => {
    const lines: string[] = ['h1;h2;h3;h4;h5;h6']
    for (let i = 0; i < 999; i++) lines.push(`${i};${i};${i};${i};${i};${i}`)
    const { sheet } = csvToSheet(enc(lines.join('\r\n')), 'csv')
    expect(sheet.rows).toBeGreaterThanOrEqual(1000)
    expect(getCell(sheet, 999, 5)).toBe('998') // последняя строка данных (i=998)
  })
})

describe('csv: запись листа', () => {
  it('roundtrip: кавычки только там, где нужны; BOM и CRLF на месте', () => {
    let sheet = createSheet()
    for (const [r, c, v] of [
      [0, 0, 'Фамилия'],
      [0, 1, 'Сумма'],
      [1, 0, 'Иванов'],
      [1, 1, '10000'],
      [2, 0, 'с; точкой'],
      [2, 1, 'с "кавычками"'],
      [3, 0, '  с пробелами  '],
    ] as const)
      sheet = withCell(sheet, r, c, v)

    const text = sheetToCsv(sheet, ';')
    expect(text.startsWith('\uFEFF')).toBe(true)
    expect(text.includes('Фамилия;Сумма\r\n')).toBe(true)
    expect(text.includes('"с; точкой"')).toBe(true)
    expect(text.includes('"с ""кавычками"""')).toBe(true)
    expect(text.includes('"  с пробелами  "')).toBe(true)

    // и обратно — значения те же
    const { sheet: back } = csvToSheet(new TextEncoder().encode(text.slice(1)), 'csv')
    for (const [r, c] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 0],
      [2, 1],
      [3, 0],
    ] as const)
      expect(getCell(back, r, c)).toBe(sheet.cells.get(cellKey(r, c)))
  })

  it('пустой лист пишет одну пустую строку', () => {
    const text = sheetToCsv(createSheet(), ',')
    expect(text).toBe('\uFEFF\r\n')
  })
})
