import { describe, expect, it } from 'vitest'
import { borderStyleChanges, mergeEdgeSides, sidesForCell, styleWithBorders } from './borders'
import { type MergeRect } from './merges'
import { type NormRange, selectionOf } from './selection'
import { type CellStyle, createSheet, type SheetModel, withStyle } from './sheet'

/* novagrid-049: границы ячеек — виды, композиция стиля, периметр объединения */

const n = (r1: number, c1: number, r2: number, c2: number): NormRange => ({ r1, c1, r2, c2 })

describe('sidesForCell: стороны вида для ячейки диапазона', () => {
  const box = n(0, 0, 2, 2)

  it('все — четыре стороны у каждой ячейки, включая центр', () => {
    expect(sidesForCell('all', box, 1, 1)).toEqual({ top: true, right: true, bottom: true, left: true })
  })

  it('внешние — углам по две стороны, центру ничего', () => {
    expect(sidesForCell('outer', box, 0, 0)).toEqual({ top: true, left: true })
    expect(sidesForCell('outer', box, 0, 1)).toEqual({ top: true })
    expect(sidesForCell('outer', box, 2, 2)).toEqual({ bottom: true, right: true })
    expect(sidesForCell('outer', box, 1, 1)).toBeNull()
  })

  it('сторона — только своему краю диапазона', () => {
    expect(sidesForCell('top', box, 0, 2)).toEqual({ top: true })
    expect(sidesForCell('top', box, 1, 2)).toBeNull()
    expect(sidesForCell('bottom', box, 2, 0)).toEqual({ bottom: true })
    expect(sidesForCell('left', box, 1, 0)).toEqual({ left: true })
    expect(sidesForCell('right', box, 1, 2)).toEqual({ right: true })
  })

  it('убрать — null: стороны не добавляются, снятие идёт стилем', () => {
    expect(sidesForCell('none', box, 0, 0)).toBeNull()
  })
})

describe('styleWithBorders: композиция стиля со сторонами', () => {
  it('стороны дописываются к стоящим: верхняя не стирает нижнюю', () => {
    const base: CellStyle = { bold: true, borders: { bottom: true, left: true } }
    expect(styleWithBorders(base, { top: true })).toEqual({
      bold: true,
      borders: { top: true, bottom: true, left: true },
    })
  })

  it('стиля нет — появляется стиль только с границами', () => {
    expect(styleWithBorders(undefined, { top: true })).toEqual({ borders: { top: true } })
  })

  it('снятие границ сохраняет остальные свойства стиля', () => {
    expect(styleWithBorders({ bold: true, borders: { top: true } }, null)).toEqual({ bold: true })
  })

  it('снятие у стиля из одних границ даёт undefined (стиля нет)', () => {
    expect(styleWithBorders({ borders: { top: true } }, null)).toBeUndefined()
  })

  it('ложных сторон в модели нет: false выпадает', () => {
    expect(styleWithBorders(undefined, { top: true, bottom: false })).toEqual({
      borders: { top: true },
    })
  })
})

describe('borderStyleChanges: правки для выделения', () => {
  it('внешние на 2×2 — у каждой ячейки свои стороны, у углов по две', () => {
    const sheet = createSheet(10, 10)
    const sel = { active: { row: 0, col: 0 }, ranges: [{ fr: 0, fc: 0, tr: 1, tc: 1 }] }
    const changes = borderStyleChanges(sheet, sel, 'outer')
    expect(changes).toHaveLength(4)
    const by = (r: number, c: number) => changes.find((ch) => ch.row === r && ch.col === c)
    expect(by(0, 0)?.after?.borders).toEqual({ top: true, left: true })
    expect(by(0, 1)?.after?.borders).toEqual({ top: true, right: true })
    expect(by(1, 0)?.after?.borders).toEqual({ bottom: true, left: true })
    expect(by(1, 1)?.after?.borders).toEqual({ bottom: true, right: true })
  })

  it('уже стоящие стороны не пишутся повторно (noop)', () => {
    let sheet: SheetModel = createSheet(10, 10)
    sheet = withStyle(sheet, 0, 0, { borders: { top: true, bottom: true, left: true, right: true } })
    expect(borderStyleChanges(sheet, selectionOf(0, 0), 'all')).toEqual([])
    // а снять есть что
    expect(borderStyleChanges(sheet, selectionOf(0, 0), 'none')).toHaveLength(1)
  })

  it('снимать нечего — правок нет', () => {
    expect(borderStyleChanges(createSheet(10, 10), selectionOf(0, 0), 'none')).toEqual([])
  })

  it('несмежные пересекающиеся области дедуплицируются', () => {
    const sheet = createSheet(10, 10)
    const sel = {
      active: { row: 0, col: 0 },
      ranges: [
        { fr: 0, fc: 0, tr: 1, tc: 1 },
        { fr: 1, fc: 1, tr: 2, tc: 2 },
      ],
    }
    const changes = borderStyleChanges(sheet, sel, 'all')
    const keys = new Set(changes.map((ch) => `${ch.row}:${ch.col}`))
    expect(keys).toEqual(new Set(['0:0', '0:1', '1:0', '1:1', '2:1', '2:2', '1:2']))
  })
})

describe('mergeEdgeSides: периметр объединённой ячейки', () => {
  const mg: MergeRect = { r1: 0, c1: 0, r2: 1, c2: 1 }

  it('сторона края рисуется, если она есть хотя бы у одной ячейки края', () => {
    let sheet = createSheet(10, 10)
    // нижняя грань — у правой нижней ячейки, левая — у левой верхней
    sheet = withStyle(sheet, 1, 1, { borders: { bottom: true } })
    sheet = withStyle(sheet, 0, 0, { borders: { left: true } })
    expect(mergeEdgeSides(sheet, mg)).toEqual({ top: false, right: false, bottom: true, left: true })
  })

  it('без границ — все стороны false', () => {
    expect(mergeEdgeSides(createSheet(10, 10), mg)).toEqual({
      top: false,
      right: false,
      bottom: false,
      left: false,
    })
  })

  it('внутренние стороны ячеек на периметр не попадают', () => {
    let sheet = createSheet(10, 10)
    // правая сторона левой верхней ячейки — внутренняя для объединения 2×2
    sheet = withStyle(sheet, 0, 0, { borders: { right: true } })
    const sides = mergeEdgeSides(sheet, mg)
    expect(sides.right).toBe(false)
  })
})
