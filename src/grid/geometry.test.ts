import { describe, expect, it } from 'vitest'
import {
  cellAtPoint,
  cellRect,
  cellRefName,
  colLayoutOf,
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

describe('geometry: переменные ширины колонок (novagrid-020)', () => {
  const widths = new Map([
    [0, 200], // A вдвое шире стандарта
    [2, 48], // C вдвое уже
  ])

  it('равномерная раскладка без переопределений считает как раньше', () => {
    const lay = colLayoutOf(26, null)
    expect(lay.x0(3)).toBe(3 * 96)
    expect(lay.width(5)).toBe(96)
    expect(lay.totalW).toBe(26 * 96)
    expect(lay.colAt(250)).toBe(2)
  })

  it('переопределения меняют x0/width/totalW, соседние — по дефолту', () => {
    const lay = colLayoutOf(26, widths)
    expect(lay.width(0)).toBe(200)
    expect(lay.x0(1)).toBe(200)
    expect(lay.width(1)).toBe(96)
    expect(lay.width(2)).toBe(48)
    expect(lay.x0(3)).toBe(200 + 96 + 48)
    expect(lay.width(3)).toBe(96)
    expect(lay.totalW).toBe(26 * 96 + (200 - 96) + (48 - 96))
  })

  it('colAt находит колонку по точке внутри переопределённых границ', () => {
    const lay = colLayoutOf(26, widths)
    expect(lay.colAt(199)).toBe(0)
    expect(lay.colAt(200)).toBe(1)
    expect(lay.colAt(343.9)).toBe(2) // 296..344 — узкая C
    expect(lay.colAt(344)).toBe(3) // граница принадлежит правой колонке
    expect(lay.colAt(-1)).toBe(-1)
  })

  it('cellRect/cellAtPoint/totalSize учитывают ширины', () => {
    const lay = colLayoutOf(26, widths)
    const r = cellRect(0, 3, 0, 0, undefined, lay)
    expect(r.x).toBe(44 + 200 + 96 + 48)
    expect(r.w).toBe(96)
    // точка внутри узкой колонки C попадает в неё же и обратно
    const hit = cellAtPoint(44 + 300, 40, 0, 0, undefined, lay)
    expect(hit?.col).toBe(2)
    expect(cellAtPoint(r.x + r.w / 2, r.y + r.h / 2, 0, 0, undefined, lay)?.col).toBe(3)
    expect(totalSize(100, 26, undefined, lay).w).toBe(44 + lay.totalW)
  })

  it('visible находит колонки вьюпорта с переменными границами', () => {
    const lay = colLayoutOf(26, widths)
    // вьюпорт от 200 (начало B) шириной 192 → B и C, D начинается на 344
    const v = lay.visible(192, 200)
    expect(v.first).toBe(1)
    expect(v.last).toBe(3)
  })
})
