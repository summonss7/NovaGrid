import { describe, expect, it } from 'vitest'
import {
  cellAtPoint,
  cellRect,
  cellRefName,
  colName,
  scrollIntoView,
  totalSize,
  visibleCols,
  visibleRows,
} from './geometry'

describe('geometry: адресация', () => {
  it('colName идёт A…Z, AA, AB… как в Excel', () => {
    expect(colName(0)).toBe('A')
    expect(colName(25)).toBe('Z')
    expect(colName(26)).toBe('AA')
    expect(colName(29)).toBe('AD')
    expect(colName(701)).toBe('ZZ')
    expect(colName(702)).toBe('AAA')
  })

  it('cellRefName — адрес в стиле Excel (0-based внутри → 1-based снаружи)', () => {
    expect(cellRefName(0, 0)).toBe('A1')
    expect(cellRefName(6, 2)).toBe('C7')
    expect(cellRefName(99999, 29)).toBe('AD100000')
  })
})

describe('geometry: виртуализация', () => {
  it('visibleRows/visibleCols считают только видимый диапазон', () => {
    // вьюпорт 600px высотой при строках 30px → 20 строк + запас на частичные
    const r = visibleRows(3000, 600)
    expect(r.first).toBe(100)
    expect(r.last).toBeGreaterThanOrEqual(119)
    expect(r.last).toBeLessThanOrEqual(121)
    const c = visibleCols(960, 800)
    expect(c.first).toBe(10)
    expect(c.last).toBeGreaterThanOrEqual(17)
  })

  it('отрицательная прокрутка не даёт отрицательных индексов', () => {
    expect(visibleRows(-50, 600).first).toBe(0)
    expect(visibleCols(-10, 400).first).toBe(0)
  })
})

describe('geometry: координаты', () => {
  it('cellAtPoint различает шапки и контент с учётом прокрутки', () => {
    const corner = cellAtPoint(10, 10)
    expect(corner?.kind).toBe('corner')
    const colHead = cellAtPoint(60, 10)
    expect(colHead?.kind).toBe('colHeader')
    expect(colHead?.col).toBe(0)
    const rowHead = cellAtPoint(10, 70, 0, 0)
    expect(rowHead?.kind).toBe('rowHeader')
    expect(rowHead?.row).toBe(1)
    // прокрутка: точка вьюпорта (60, 40) при scroll 96×90 → ячейка D4
    const cell = cellAtPoint(60, 40, 96, 90)
    expect(cell?.kind).toBe('cell')
    expect(cell?.row).toBe(3)
    expect(cell?.col).toBe(1)
    expect(cellAtPoint(-5, 10)).toBeNull()
  })

  it('cellRect и cellAtPoint взаимно обратны', () => {
    const scrollX = 192
    const scrollY = 150
    const r = cellRect(7, 3, scrollX, scrollY)
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    const hit = cellAtPoint(cx, cy, scrollX, scrollY)
    expect(hit?.row).toBe(7)
    expect(hit?.col).toBe(3)
  })

  it('totalSize — габариты прокручиваемой области', () => {
    const s = totalSize(100, 26)
    expect(s.w).toBe(44 + 26 * 96)
    expect(s.h).toBe(30 + 100 * 30)
  })

  it('scrollIntoView докручивает до ячейки за краем вьюпорта', () => {
    // ячейка C50 ниже вьюпорта 600px при прокрутке 0 → нужен скролл
    const t = scrollIntoView(49, 2, 0, 0, 800, 600)
    expect(t.scrollY).toBeGreaterThan(0)
    // ячейка над вьюпортом → к её началу
    const up = scrollIntoView(0, 0, 0, 900, 800, 600)
    expect(up.scrollY).toBe(0)
    // уже видима — не трогаем прокрутку
    const stay = scrollIntoView(1, 1, 0, 0, 800, 600)
    expect(stay).toEqual({ scrollX: 0, scrollY: 0 })
  })
})
