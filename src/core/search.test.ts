import { describe, expect, it } from 'vitest'
import { parseQueryTerms, searchBook, searchSheet } from './search'
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

  it('умный поиск по книге: слова могут быть в разных ячейках строки', () => {
    const other = sheetOf([
      ['Фамилия', 'Отдел'],
      ['Иванов', 'Продажи'],
      ['Иванов', 'Склад'],
    ])
    const hits = searchBook([{ sheet: other, filters: [] }], 'иванов продажи', plain)
    expect(hits).toEqual([
      { tab: 0, row: 1, col: 0 },
      { tab: 0, row: 1, col: 1 },
    ])
  })
})

describe('search: умный поиск по словам (novagrid-065)', () => {
  const staff = sheetOf([
    ['Фамилия', 'Должность', 'Отдел'],
    ['Иванов', 'Менеджер', 'Продажи'],
    ['Петров', 'Инженер', 'Склад'],
    ['Иванова', 'Менеджер', 'Склад'],
    ['Сидорова', 'Директор', 'Продажи'],
  ])

  it('два слова — строки, где есть оба; подсвечиваются ячейки со словами', () => {
    expect(searchSheet(staff, 'иванов продажи', plain)).toEqual([
      { tab: -1, row: 1, col: 0 },
      { tab: -1, row: 1, col: 2 },
    ])
  })

  it('слово ищется подстрокой: «иванов» находит и «Иванова»', () => {
    expect(searchSheet(staff, 'иванов склад', plain)).toEqual([
      { tab: -1, row: 3, col: 0 },
      { tab: -1, row: 3, col: 2 },
    ])
  })

  it('оба слова могут быть в одной ячейке', () => {
    const s = sheetOf([['Примечание'], ['менеджер продаж'], ['инженер склад']])
    expect(searchSheet(s, 'менеджер продаж', plain)).toEqual([{ tab: -1, row: 1, col: 0 }])
  })

  it('строка без одного из слов не совпадает', () => {
    expect(searchSheet(staff, 'директор склад', plain)).toEqual([])
  })

  it('исключение «-слово» убирает строки с этим словом', () => {
    expect(searchSheet(staff, 'менеджер -склад', plain)).toEqual([
      { tab: -1, row: 1, col: 1 },
    ])
    expect(searchSheet(staff, 'иванов -склад', plain)).toEqual([
      { tab: -1, row: 1, col: 0 },
    ])
  })

  it('фраза в кавычках — точная подстрока одной ячейки, не через границы', () => {
    const s = sheetOf([['Кто'], ['Иванов Петр'], ['Иванов', 'Петров']])
    expect(searchSheet(s, '"иванов петр"', plain)).toEqual([{ tab: -1, row: 1, col: 0 }])
    expect(searchSheet(s, '"иванов петров"', plain)).toEqual([])
  })

  it('фраза — такое же слово запроса: «фраза слово» требует оба', () => {
    const s = sheetOf([['Текст'], ['счёт за январь оплачен'], ['счёт за февраль']])
    expect(searchSheet(s, '"за январь" оплачен', plain)).toEqual([{ tab: -1, row: 1, col: 0 }])
    expect(searchSheet(s, '"за январь" неоплачен', plain)).toEqual([])
  })

  it('без учёта регистра Ё=Е: «елка» находит «Ёлка» и наоборот', () => {
    const s = sheetOf([['Ёлка'], ['хвойные']])
    expect(searchSheet(s, 'елка', plain)).toEqual([{ tab: -1, row: 0, col: 0 }])
    expect(searchSheet(s, 'ёлка', plain)).toEqual([{ tab: -1, row: 0, col: 0 }])
    // с учётом регистра свёртки нет: «ел» ≠ «ёл»
    expect(searchSheet(s, 'ёл', { caseSensitive: true, wholeCell: false })).toEqual([])
    expect(searchSheet(s, 'Ёл', { caseSensitive: true, wholeCell: false })).toEqual([
      { tab: -1, row: 0, col: 0 },
    ])
  })

  it('одно слово без операторов — прежний поиск подстроки (теперь с Ё=Е)', () => {
    const s = sheetOf([['Ёлкин'], ['елкин']])
    expect(searchSheet(s, 'елкин', plain)).toEqual([
      { tab: -1, row: 0, col: 0 },
      { tab: -1, row: 1, col: 0 },
    ])
  })

  it('только исключения — буквальный поиск всего запроса, как раньше', () => {
    const s = sheetOf([['Значение'], ['-5'], ['5']])
    expect(searchSheet(s, '-5', plain)).toEqual([{ tab: -1, row: 1, col: 0 }])
  })

  it('«ячейка целиком» отключает разбор: запрос сравнивается буквально', () => {
    const s = sheetOf([['ФИО'], ['Иванов Менеджер'], ['Иванов']])
    expect(searchSheet(s, 'Иванов Менеджер', { caseSensitive: false, wholeCell: true })).toEqual([
      { tab: -1, row: 1, col: 0 },
    ])
  })

  it('скрытые фильтром строки не собирают слова', () => {
    // строка 3 (Иванова, Склад) скрыта — «склад» остаётся только в строке 2
    expect(searchSheet(staff, 'склад инженер', plain, [0, 1, 2, 4])).toEqual([
      { tab: -1, row: 2, col: 1 },
      { tab: -1, row: 2, col: 2 },
    ])
  })

  it('пробелы и регистр слов: пустые токены отбрасываются', () => {
    expect(searchSheet(staff, '  менеджер   ', plain)).toEqual([
      { tab: -1, row: 1, col: 1 },
      { tab: -1, row: 3, col: 1 },
    ])
  })
})

describe('search: разбор запроса', () => {
  it('слова, фразы и исключения', () => {
    expect(parseQueryTerms('иванов -склад "за январь"', false)).toEqual([
      { needle: 'иванов', exclude: false },
      { needle: 'склад', exclude: true },
      { needle: 'за январь', exclude: false },
    ])
  })

  it('исключение фразы, одиночный минус и пустые кавычки отбрасываются', () => {
    expect(parseQueryTerms('-"не это" - ""', false)).toEqual([{ needle: 'не это', exclude: true }])
    expect(parseQueryTerms('слово -', false)).toEqual([{ needle: 'слово', exclude: false }])
  })

  it('незакрытая кавычка — фраза до конца слова', () => {
    expect(parseQueryTerms('"фраза', false)).toEqual([{ needle: 'фраза', exclude: false }])
  })

  it('с учётом регистра текст не сворачивается', () => {
    expect(parseQueryTerms('Иванов Ёлка', true)).toEqual([
      { needle: 'Иванов', exclude: false },
      { needle: 'Ёлка', exclude: false },
    ])
  })
})
