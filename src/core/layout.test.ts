/*
 * Юнит-тесты операций вставки/удаления строк и колонок (novagrid-045):
 * сдвиг значений/стилей, ремап ссылок формул (включая #REF!), сдвиг ширин,
 * фильтров и закрепления.
 */

import { describe, expect, it } from 'vitest'
import {
  shiftColWidths,
  shiftFilterCols,
  shiftFreeze,
  shiftSheetCols,
  shiftSheetRows,
} from './layout'
import { createSheet, getCell, getStyle, withCell, withStyle } from './sheet'

function seed() {
  let sh = createSheet(10, 6)
  sh = withCell(sh, 0, 0, 'Имя')
  sh = withCell(sh, 1, 0, 'Анна')
  sh = withCell(sh, 2, 0, '=A2 & "!"')
  sh = withCell(sh, 1, 1, '10')
  sh = withCell(sh, 2, 1, '=B2*2')
  return sh
}

describe('layout: вставка/удаление строк (novagrid-045)', () => {
  it('вставка строки опускает данные и сдвигает ссылки формул', () => {
    const sh = shiftSheetRows(seed(), 1, 1)
    expect(getCell(sh, 0, 0)).toBe('Имя')
    expect(getCell(sh, 1, 0)).toBe('')
    expect(getCell(sh, 2, 0)).toBe('Анна')
    expect(getCell(sh, 3, 0)).toBe('=A3 & "!"')
    expect(getCell(sh, 3, 1)).toBe('=B3*2')
  })

  it('удаление строки поднимает данные; ссылки на удалённую — #REF!', () => {
    const sh = shiftSheetRows(seed(), 1, -1)
    expect(getCell(sh, 1, 0)).toBe('=#REF! & "!"')
    expect(getCell(sh, 1, 1)).toBe('=#REF!*2')
    expect(getCell(sh, 0, 0)).toBe('Имя')
  })

  it('стили переезжают вместе с ячейками', () => {
    let sh = withStyle(seed(), 2, 0, { bold: true, bg: 'FFEE00' })
    sh = shiftSheetRows(sh, 1, 1)
    expect(getStyle(sh, 3, 0)).toEqual({ bold: true, bg: 'FFEE00' })
    expect(getStyle(sh, 2, 0)).toBeUndefined()
  })

  it('абсолютные ссылки тоже сдвигаются, строки в кавычках не трогаются', () => {
    let sh = createSheet(6, 3)
    sh = withCell(sh, 4, 0, '=$A$2+A1&"A2"')
    // вставка перед строкой 1: $A$2 уезжает вниз, A1 (выше вставки) стоит
    const moved = shiftSheetRows(sh, 1, 1)
    expect(getCell(moved, 5, 0)).toBe('=$A$3+A1&"A2"')
  })
})

describe('layout: вставка/удаление колонок (novagrid-045)', () => {
  it('вставка колонки сдвигает значения и ссылки', () => {
    const sh = shiftSheetCols(seed(), 1, 1)
    expect(getCell(sh, 1, 1)).toBe('')
    expect(getCell(sh, 1, 2)).toBe('10')
    expect(getCell(sh, 2, 2)).toBe('=C2*2')
  })

  it('удаление колонки: ссылки на неё — #REF!', () => {
    // формула в колонке A ссылается на удаляемую B — сама остаётся
    let sh = seed()
    sh = withCell(sh, 4, 0, '=B2*2')
    const del = shiftSheetCols(sh, 1, -1)
    expect(getCell(del, 4, 0)).toBe('=#REF!*2')
    expect(getCell(del, 0, 0)).toBe('Имя')
  })
})

describe('layout: сопутствующее состояние (novagrid-045)', () => {
  it('ширины колонок едут вместе с колонками', () => {
    const w = shiftColWidths(new Map([[0, 120], [2, 200]]), 1, 1)
    expect(w?.get(0)).toBe(120)
    expect(w?.get(3)).toBe(200)
    expect(w?.has(2)).toBe(false)
    const d = shiftColWidths(new Map([[0, 120], [2, 200]]), 1, -1)
    expect(d?.get(1)).toBe(200)
  })

  it('фильтры колонок сдвигаются, удалённые пропадают', () => {
    expect(shiftFilterCols([{ col: 0 }, { col: 2 }], 1, 1)).toEqual([{ col: 0 }, { col: 3 }])
    expect(shiftFilterCols([{ col: 0 }, { col: 2 }], 2, -1)).toEqual([{ col: 0 }])
  })

  it('закрепление расширяется вставкой внутри зоны и сжимается удалением', () => {
    expect(shiftFreeze({ rows: 2, cols: 2 }, 'col', 1, 1)).toEqual({ rows: 2, cols: 3 })
    expect(shiftFreeze({ rows: 2, cols: 2 }, 'col', 1, -1)).toEqual({ rows: 2, cols: 1 })
    expect(shiftFreeze({ rows: 2, cols: 2 }, 'col', 5, 1)).toEqual({ rows: 2, cols: 2 })
    expect(shiftFreeze({ rows: 1, cols: 0 }, 'row', 0, -1)).toEqual({ rows: 0, cols: 0 })
  })
})
