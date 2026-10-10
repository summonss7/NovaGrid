import { beforeEach, describe, expect, it } from 'vitest'
import { visibleRowsOf, type ColumnFilter } from './filter'
import { recalcSheet } from '../formula/engine'
import {
  type ReplaceOptions,
  replaceAllInSheet,
  replaceCellRaw,
  replaceHitsInSheet,
} from './replace'
import { createSheet, getCell, type SheetModel, withCell } from './sheet'
import { gridStore } from './store'

const OPTS = (patch: Partial<ReplaceOptions> = {}): ReplaceOptions => ({
  caseSensitive: false,
  wholeCell: false,
  inFormulas: false,
  ...patch,
})

function sheetOf(cells: readonly [number, number, string][]): SheetModel {
  let sheet = createSheet(10, 5)
  for (const [row, col, v] of cells) sheet = withCell(sheet, row, col, v)
  recalcSheet(sheet)
  return sheet
}

describe('replace: движок (Этап 7)', () => {
  it('подстрока: все вхождения, регистр не важен, замена вставляется как есть', () => {
    const sheet = sheetOf([
      [0, 0, 'Иванов Иван'],
      [1, 0, 'иванов и иванов'],
    ])
    const changes = replaceAllInSheet(sheet, 'ИваНов', 'Петров', OPTS())
    expect(changes).toEqual([
      { row: 0, col: 0, before: 'Иванов Иван', after: 'Петров Иван' },
      { row: 1, col: 0, before: 'иванов и иванов', after: 'Петров и Петров' },
    ])
  })

  it('учёт регистра: совпадает только точный регистр', () => {
    const sheet = sheetOf([
      [0, 0, 'Иванов'],
      [1, 0, 'иванов'],
    ])
    const changes = replaceAllInSheet(sheet, 'Иванов', 'Петров', OPTS({ caseSensitive: true }))
    expect(changes.map((c) => c.row)).toEqual([0])
  })

  it('«ячейка целиком»: замена всего значения, соседние части не трогаются', () => {
    const sheet = sheetOf([
      [0, 0, 'Иванов'],
      [1, 0, 'Ивановский'],
    ])
    const changes = replaceAllInSheet(sheet, 'Иванов', 'Петров', OPTS({ wholeCell: true }))
    expect(changes).toEqual([{ row: 0, col: 0, before: 'Иванов', after: 'Петров' }])
  })

  it('значения (по умолчанию): совпавший результат формулы становится статикой', () => {
    const sheet = sheetOf([[0, 0, '=1+1']])
    expect(replaceCellRaw(sheet, 0, 0, '2', '3', OPTS())).toBe('3')
    expect(replaceCellRaw(sheet, 0, 0, '1+1', '3', OPTS())).toBeNull() // в значениях формулы не видно
  })

  it('«искать в формулах»: заменяется текст после «=», формула остаётся формулой', () => {
    const sheet = sheetOf([
      [0, 0, '=SUM(A1:A2)'],
      [1, 0, 'SUM'],
    ])
    const opts = OPTS({ inFormulas: true })
    expect(replaceCellRaw(sheet, 0, 0, 'SUM', 'MAX', opts)).toBe('=MAX(A1:A2)')
    // обычная ячейка в этом режиме заменяется по своему тексту
    expect(replaceCellRaw(sheet, 1, 0, 'SUM', 'MAX', opts)).toBe('MAX')
  })

  it('чужие формулы (∛) не трогаются ни в одном режиме', () => {
    const sheet: SheetModel = {
      ...createSheet(10, 5),
      cells: new Map([['0:0', '=UNKNOWNFN(1)']]),
      formulaCache: new Map([['0:0', '42']]),
      maxRow: 0,
      maxCol: 0,
    }
    recalcSheet(sheet)
    // значение из кэша («42») не заменяется
    expect(replaceCellRaw(sheet, 0, 0, '42', '7', OPTS())).toBeNull()
    // и текст чужой формулы тоже
    expect(replaceCellRaw(sheet, 0, 0, 'UNKNOWNFN', 'OTHER', OPTS({ inFormulas: true }))).toBeNull()
  })

  it('скрытые фильтром строки не заменяются (замена = то, что нашлось)', () => {
    const sheet = sheetOf([
      [0, 0, 'Иванов'],
      [1, 0, 'Иванов'],
      [2, 0, 'Иванов'],
    ])
    const changes = replaceAllInSheet(sheet, 'Иванов', 'Петров', OPTS(), [0, 2])
    expect(changes.map((c) => c.row)).toEqual([0, 2])
  })

  it('пустой запрос и «замена на то же» не дают изменений', () => {
    const sheet = sheetOf([[0, 0, 'Иванов']])
    expect(replaceAllInSheet(sheet, '', 'X', OPTS())).toEqual([])
    expect(replaceAllInSheet(sheet, 'Иванов', 'Иванов', OPTS())).toEqual([])
  })

  it('счётчик совпадений согласован с заменой (в формулах считает текст формулы)', () => {
    const sheet = sheetOf([
      [0, 0, '=SUM(A1:A2)'],
      [1, 0, 'SUM'],
    ])
    const opts = OPTS({ inFormulas: true })
    expect(replaceHitsInSheet(sheet, 'SUM', opts).map((h) => h.row)).toEqual([0, 1])
    expect(replaceAllInSheet(sheet, 'SUM', 'MAX', opts)).toHaveLength(2)
  })
})

const s = () => gridStore.getState()

describe('store: «Найти и заменить» (Этап 7)', () => {
  beforeEach(() => {
    s().seedDemo() // 7×3: Иванов/Петров/…; «Продажи» в B2, B4, B7
  })

  it('«Заменить все» на листе: значения обновились, один Ctrl+Z вернул всё', () => {
    s().openReplace()
    s().setReplaceQuery('Продажи')
    s().setReplaceField({ replacement: 'Сбыт' })
    expect(s().replace.hits).toHaveLength(3)
    s().replaceAll()
    expect(s().replace.lastCount).toBe(3)
    expect(getCell(s().sheet, 1, 1)).toBe('Сбыт')
    expect(getCell(s().sheet, 6, 1)).toBe('Сбыт')
    // счётчик «Найдено» после батча — ноль (заменённое не совпадает)
    expect(s().replace.hits).toHaveLength(0)
    s().undo() // один Ctrl+Z — весь батч
    expect(getCell(s().sheet, 1, 1)).toBe('Продажи')
    expect(getCell(s().sheet, 3, 1)).toBe('Продажи')
    expect(getCell(s().sheet, 6, 1)).toBe('Продажи')
  })

  it('«Заменить все» по книге: все листы разом, один Ctrl+Z возвращает оба', () => {
    s().loadBook({
      sheets: [
        { name: 'A', sheet: sheetOf([[0, 0, 'Иванов']]) },
        { name: 'B', sheet: sheetOf([[0, 0, 'Иванов'], [1, 0, 'Иванов']]) },
      ],
    })
    s().openReplace()
    s().setReplaceField({ scope: 'book', replacement: 'Петров' })
    s().setReplaceQuery('Иванов')
    expect(s().replace.hits).toHaveLength(3)
    s().replaceAll()
    expect(s().replace.lastCount).toBe(3)
    expect(getCell(s().tabs[0].sheet, 0, 0)).toBe('Петров')
    expect(getCell(s().tabs[1].sheet, 0, 0)).toBe('Петров')
    expect(getCell(s().tabs[1].sheet, 1, 0)).toBe('Петров')
    s().undo() // один Ctrl+Z откатывает батч на всех листах
    expect(getCell(s().tabs[0].sheet, 0, 0)).toBe('Иванов')
    expect(getCell(s().tabs[1].sheet, 0, 0)).toBe('Иванов')
    expect(getCell(s().tabs[1].sheet, 1, 0)).toBe('Иванов')
    // redo возвращает батч обратно целиком
    s().redo()
    expect(getCell(s().tabs[0].sheet, 0, 0)).toBe('Петров')
    expect(getCell(s().tabs[1].sheet, 1, 0)).toBe('Петров')
  })

  it('«Заменить»: текущее совпадение меняется, серия проходит каждое один раз', () => {
    s().openReplace()
    s().setReplaceQuery('Продажи')
    s().setReplaceField({ replacement: 'Сбыт' })
    expect(s().replace.hits).toHaveLength(3)
    expect(s().replace.index).toBe(0)
    s().replaceCurrent()
    expect(getCell(s().sheet, 1, 1)).toBe('Сбыт')
    expect(s().replace.hits).toHaveLength(2)
    expect(s().replace.lastCount).toBe(1)
    s().replaceCurrent()
    s().replaceCurrent()
    expect(getCell(s().sheet, 3, 1)).toBe('Сбыт')
    expect(getCell(s().sheet, 6, 1)).toBe('Сбыт')
    expect(s().replace.hits).toHaveLength(0)
  })

  it('замена, порождающая новое совпадение (Иван → Иванов), не зацикливается', () => {
    s().loadBook({
      sheets: [
        { name: 'A', sheet: sheetOf([[0, 0, 'Иван'], [1, 0, 'Иван']]) },
      ],
    })
    s().openReplace()
    s().setReplaceQuery('Иван')
    s().setReplaceField({ replacement: 'Иванов' })
    s().replaceCurrent() // (0,0) → Иванов
    s().replaceCurrent() // (1,0) → Иванов, а не снова (0,0)
    expect(getCell(s().sheet, 0, 0)).toBe('Иванов')
    expect(getCell(s().sheet, 1, 0)).toBe('Иванов')
  })

  it('фильтры: замена под include-фильтром прячет строку с новым значением, Ctrl+Z возвращает', () => {
    s().loadBook({
      sheets: [{ name: 'A', sheet: sheetOf([[0, 0, 'Отдел'], [1, 0, 'Продажи']]) }],
    })
    const filter: ColumnFilter = { col: 0, mode: 'include', values: ['Продажи'] }
    s().setColumnFilter(filter)
    expect(visibleRowsOf(s().sheet, s().filters)).toEqual([1])
    s().openReplace()
    s().setReplaceQuery('Продажи')
    s().setReplaceField({ replacement: 'Сбыт' })
    s().replaceAll()
    // новое значение не входит в include-список — строка скрылась (RowLayout пересчитан)
    expect(visibleRowsOf(s().sheet, s().filters)).toEqual([])
    expect(getCell(s().sheet, 1, 0)).toBe('Сбыт') // значение на месте
    s().undo()
    expect(visibleRowsOf(s().sheet, s().filters)).toEqual([1])
    expect(getCell(s().sheet, 1, 0)).toBe('Продажи')
  })

  it('Ctrl+H наследует запрос открытой панели поиска и закрывает её', () => {
    s().openSearch()
    s().setSearchQuery('Логистика')
    s().openReplace()
    expect(s().search.open).toBe(false)
    expect(s().replace.query).toBe('Логистика')
    expect(s().replace.hits).toHaveLength(2)
    s().closeReplace()
    expect(s().replace.open).toBe(false)
    // повторное открытие помнит прошлый запрос
    s().openReplace()
    expect(s().replace.query).toBe('Логистика')
  })
})
