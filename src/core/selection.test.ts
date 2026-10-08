import { describe, expect, it } from 'vitest'
import { boundingBox, inSelection, normalize, range, selectedCells, selectionOf } from './selection'

describe('selection: модель выделения Ф5', () => {
  it('normalize приводит диапазон к r1<=r2, c1<=c2 при растягивании в любую сторону', () => {
    expect(normalize({ fr: 4, fc: 3, tr: 1, tc: 6 })).toEqual({ r1: 1, c1: 3, r2: 4, c2: 6 })
    expect(normalize(range(5, 5))).toEqual({ r1: 5, c1: 5, r2: 5, c2: 5 })
  })

  it('inSelection проверяет попадание в любую из несмежных областей', () => {
    const sel = { active: { row: 0, col: 0 }, ranges: [range(1, 1), range(3, 3)] }
    expect(inSelection(sel, 1, 1)).toBe(true)
    expect(inSelection(sel, 3, 3)).toBe(true)
    expect(inSelection(sel, 2, 2)).toBe(false)
  })

  it('Ctrl-несмежные области: ячейки перечисляются без повторов при пересечении', () => {
    const sel = {
      active: { row: 0, col: 0 },
      ranges: [
        { fr: 0, fc: 0, tr: 1, tc: 1 }, // A1:B2
        { fr: 1, fc: 1, tr: 2, tc: 2 }, // B2:C3 — пересекается в B2
      ],
    }
    const { count, rows, cols } = selectedCells(sel)
    expect(count).toBe(7) // 4 + 4 − 1 повтор (B2)
    const keys = rows.map((r, i) => `${r}:${cols[i]}`)
    expect(new Set(keys).size).toBe(count)
  })

  it('boundingBox — минимальный охватывающий прямоугольник (основа копирования)', () => {
    const sel = {
      active: { row: 0, col: 0 },
      ranges: [{ fr: 2, fc: 1, tr: 3, tc: 2 }, range(6, 5)],
    }
    expect(boundingBox(sel)).toEqual({ r1: 2, c1: 1, r2: 6, c2: 5 })
  })

  it('selectionOf создаёт выделение из одной активной ячейки', () => {
    const sel = selectionOf(2, 3)
    expect(sel.active).toEqual({ row: 2, col: 3 })
    expect(sel.ranges).toEqual([range(2, 3)])
    expect(selectedCells(sel).count).toBe(1)
  })
})
