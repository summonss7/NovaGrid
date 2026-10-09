import { describe, expect, it } from 'vitest'
import { searchBook, searchSheet } from './search'
import { createSheet, withCell } from './sheet'

function sheetOf(rows: readonly (readonly string[])[]) {
  let sheet = createSheet()
  rows.forEach((cells, r) => cells.forEach((v, c) => (sheet = withCell(sheet, r, c, v))))
  return sheet
}

const sheet = sheetOf([
  ['Фамилия', 'Сумма'],
  ['Иванов', '10000'],
  ['Петров', '12500'],
  ['Иванова', '7000'],
])

const plain = { caseSensitive: false, wholeCell: false }

describe('search: лист', () => {
  it('подстрока без учёта регистра: «иван» находит Иванов и Иванова', () => {
    const hits = searchSheet(sheet, 'иван', plain)
    expect(hits).toEqual([
      { tab: -1, row: 1, col: 0 },
      { tab: -1, row: 3, col: 0 },
    ])
  })

  it('порядок совпадений — строка, затем колонка', () => {
    let s = createSheet()
    s = withCell(s, 2, 1, 'x')
    s = withCell(s, 1, 3, 'x')
    s = withCell(s, 2, 0, 'x')
    expect(searchSheet(s, 'x', plain)).toEqual([
      { tab: -1, row: 1, col: 3 },
      { tab: -1, row: 2, col: 0 },
      { tab: -1, row: 2, col: 1 },
    ])
  })

  it('учёт регистра: «Иван» не находит «иванов»', () => {
    expect(searchSheet(sheet, 'иван', { caseSensitive: true, wholeCell: false })).toEqual([])
    expect(searchSheet(sheet, 'Иван', { caseSensitive: true, wholeCell: false }).length).toBe(2)
  })

  it('ячейка целиком: «Иванов» ≠ «Иванова»', () => {
    const hits = searchSheet(sheet, 'Иванов', { caseSensitive: false, wholeCell: true })
    expect(hits).toEqual([{ tab: -1, row: 1, col: 0 }])
  })

  it('пустой запрос — без совпадений; числа ищутся как текст', () => {
    expect(searchSheet(sheet, '', plain)).toEqual([])
    expect(searchSheet(sheet, '100', plain)).toEqual([{ tab: -1, row: 1, col: 1 }])
  })

  it('скрытые фильтром строки пропускаются (подсветка = видимое)', () => {
    const hits = searchSheet(sheet, 'Иван', plain, [1, 3])
    expect(hits.length).toBe(2)
    const filtered = searchSheet(sheet, 'Иван', plain, [3])
    expect(filtered).toEqual([{ tab: -1, row: 3, col: 0 }])
  })
})

describe('search: книга', () => {
  it('совпадения всех листов с их индексами вкладок', () => {
    const other = sheetOf([['Отдел'], ['Продажи'], ['Иваново']])
    const hits = searchBook(
      [
        { sheet, filters: [] },
        { sheet: other, filters: [] },
      ],
      'Иван',
      plain,
    )
    expect(hits).toEqual([
      { tab: 0, row: 1, col: 0 },
      { tab: 0, row: 3, col: 0 },
      { tab: 1, row: 2, col: 0 },
    ])
  })
})
