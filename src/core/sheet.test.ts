import { describe, expect, it } from 'vitest'
import {
  MAX_COLS,
  MAX_ROWS,
  SPACE_COLS,
  SPACE_ROWS,
  createSheet,
  getCell,
  isNumericCell,
  parseNumber,
  withCell,
  withCellList,
  withSpace,
} from './sheet'

describe('sheet: модель листа', () => {
  it('пустой лист отдаёт пустую строку и не хранит пустых ячеек', () => {
    const sheet = createSheet()
    expect(getCell(sheet, 5, 5)).toBe('')
    expect(sheet.cells.size).toBe(0)
    expect(sheet.maxRow).toBe(-1)
  })

  it('withCell пишет значение и расширяет границы контента и листа', () => {
    let sheet = createSheet()
    sheet = withCell(sheet, 0, 0, 'Иванов')
    sheet = withCell(sheet, 105, 30, '10000')
    expect(getCell(sheet, 0, 0)).toBe('Иванов')
    expect(sheet.maxRow).toBe(105)
    expect(sheet.maxCol).toBe(30)
    expect(sheet.rows).toBeGreaterThanOrEqual(106)
    expect(sheet.cols).toBeGreaterThanOrEqual(31)
  })

  it('запись пустой строки удаляет ячейку, но не сжимает логический размер листа', () => {
    let sheet = withCell(createSheet(), 2, 2, 'x')
    sheet = withCell(sheet, 2, 2, '')
    expect(getCell(sheet, 2, 2)).toBe('')
    expect(sheet.cells.size).toBe(0)
    expect(sheet.rows).toBeGreaterThanOrEqual(3)
  })

  it('withCell не мутирует исходную модель (иммутабельность для undo)', () => {
    const base = withCell(createSheet(), 0, 0, 'a')
    const next = withCell(base, 1, 1, 'b')
    expect(getCell(base, 1, 1)).toBe('')
    expect(getCell(next, 0, 0)).toBe('a')
    expect(getCell(next, 1, 1)).toBe('b')
  })
})

describe('withCellList: массовые правки одним клоном Map (novagrid-035)', () => {
  it('эквивалент цепочки withCell: значения, границы, удаление пустых', () => {
    let chained = withCell(createSheet(), 1, 1, 'старое')
    chained = withCell(chained, 0, 0, 'a')
    chained = withCell(chained, 3, 4, 'b')
    chained = withCell(chained, 1, 1, '') // удаление

    const bulk = withCellList(withCell(createSheet(), 1, 1, 'старое'), [
      { row: 0, col: 0, value: 'a' },
      { row: 3, col: 4, value: 'b' },
      { row: 1, col: 1, value: '' },
    ])
    expect([...bulk.cells.entries()]).toEqual([...chained.cells.entries()])
    expect(bulk.rows).toBe(chained.rows)
    expect(bulk.cols).toBe(chained.cols)
    expect(bulk.maxRow).toBe(chained.maxRow)
    expect(bulk.maxCol).toBe(chained.maxCol)
    expect(getCell(bulk, 1, 1)).toBe('')
  })

  it('пустой список возвращает ту же модель без клона', () => {
    const sheet = withCell(createSheet(), 0, 0, 'x')
    expect(withCellList(sheet, [])).toBe(sheet)
  })

  it('границы листа растут и от пустых значений (клетка за краем тронута)', () => {
    const sheet = createSheet(10, 5)
    const next = withCellList(sheet, [{ row: 20, col: 7, value: '' }])
    expect(next.rows).toBe(21)
    expect(next.cols).toBe(8)
    expect(next.maxRow).toBe(-1) // контента нет — maxRow не растёт
  })
})

describe('withSpace: запас пустого места за контентом (novagrid-032)', () => {
  it('за границей контента всегда есть пустые строки и колонки', () => {
    // таблица 500×30 целиком заполняет лист — за ней места нет
    let sheet = createSheet(500, 30)
    sheet = { ...sheet, maxRow: 499, maxCol: 29 }
    const next = withSpace(sheet)
    expect(next.rows).toBe(500 + SPACE_ROWS)
    expect(next.cols).toBe(30 + SPACE_COLS)
    expect(next.maxRow).toBe(499) // контент не меняется
    expect(next.cells).toBe(sheet.cells)
  })

  it('не сжимает уже большие границы и идемпотентен', () => {
    let sheet = createSheet(500, 30)
    sheet = { ...sheet, maxRow: 499, maxCol: 29 }
    const grown = withSpace(sheet)
    expect(withSpace(grown)).toBe(grown) // второй проход — та же ссылка
    const fresh = createSheet() // пустой лист и так просторен — без изменений
    expect(withSpace(fresh)).toBe(fresh)
  })

  it('лист не растёт за пределы Excel .xlsx', () => {
    let sheet = createSheet(MAX_ROWS, MAX_COLS)
    sheet = { ...sheet, maxRow: MAX_ROWS - 1, maxCol: MAX_COLS - 1 }
    const next = withSpace(sheet)
    expect(next.rows).toBe(MAX_ROWS)
    expect(next.cols).toBe(MAX_COLS)
  })
})

describe('parseNumber: честный разбор Этапа 1', () => {
  it('принимает целые, десятичные с точкой и запятой, знак', () => {
    expect(parseNumber('10000')).toBe(10000)
    expect(parseNumber('12.5')).toBe(12.5)
    expect(parseNumber('12,5')).toBe(12.5)
    expect(parseNumber('-3')).toBe(-3)
    expect(parseNumber('+7')).toBe(7)
    expect(parseNumber(' 42 ')).toBe(42)
  })

  it('отвергает текст, пустоту, валюту и разделители тысяч', () => {
    expect(parseNumber('Иванов')).toBeNull()
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('10 000')).toBeNull()
    expect(parseNumber('$100')).toBeNull()
    expect(parseNumber('1.2.3')).toBeNull()
  })

  it('isNumericCell отличает числовую ячейку от текстовой', () => {
    let sheet = withCell(createSheet(), 0, 0, '10000')
    sheet = withCell(sheet, 1, 0, 'Иванов')
    expect(isNumericCell(sheet, 0, 0)).toBe(true)
    expect(isNumericCell(sheet, 1, 0)).toBe(false)
  })
})
