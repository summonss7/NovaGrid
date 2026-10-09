import { describe, expect, it } from 'vitest'
import {
  columnValueCounts,
  compareCellValues,
  nearestVisibleRow,
  valuePasses,
  visibleIndexOf,
  visibleRowsOf,
} from './filter'
import { createSheet, withCell } from './sheet'

/** Лист 4×3: фамилия / отдел / сумма — как демо-сценарий ТЗ. */
function demoSheet() {
  let sheet = createSheet()
  const rows: [string, string, string][] = [
    ['Фамилия', 'Отдел', 'Сумма'],
    ['Иванов', 'Продажи', '10000'],
    ['Петров', 'Логистика', '12500'],
    ['Иванов', 'Логистика', '10000'],
    ['', 'Продажи', '4200'],
    ['Сидоров', '', '10000'],
  ]
  rows.forEach((cells, r) => cells.forEach((v, c) => (sheet = withCell(sheet, r, c, v))))
  return sheet
}

describe('filter: значение против фильтра', () => {
  it('include пропускает только перечисленные, exclude — всё, кроме них', () => {
    const f = { col: 0, mode: 'include' as const, values: ['Иванов'] }
    expect(valuePasses(f, 'Иванов')).toBe(true)
    expect(valuePasses(f, 'Петров')).toBe(false)
    expect(valuePasses(f, '')).toBe(false)

    const ex = { col: 0, mode: 'exclude' as const, values: ['Иванов'] }
    expect(valuePasses(ex, 'Петров')).toBe(true)
    expect(valuePasses(ex, 'Иванов')).toBe(false)
  })
})

describe('filter: видимые строки', () => {
  it('без активных фильтров — null (все видны, без аллокаций)', () => {
    expect(visibleRowsOf(demoSheet(), [])).toBeNull()
    expect(visibleRowsOf(demoSheet(), [{ col: 0, mode: 'include', values: [] }])).toBeNull()
  })

  it('один фильтр: A = Иванов → строки 1 и 3 (шапка скрыта)', () => {
    const vis = visibleRowsOf(demoSheet(), [{ col: 0, mode: 'include', values: ['Иванов'] }])
    expect(vis).toEqual([1, 3])
  })

  it('два фильтра объединяются по «И» (сценарий ТЗ: A = Иванов И C = 10000)', () => {
    const vis = visibleRowsOf(demoSheet(), [
      { col: 0, mode: 'include', values: ['Иванов'] },
      { col: 2, mode: 'include', values: ['10000'] },
    ])
    expect(vis).toEqual([1, 3])
  })

  it('exclude: A ≠ Иванов оставляет всех, кроме Ивановых', () => {
    const vis = visibleRowsOf(demoSheet(), [{ col: 0, mode: 'exclude', values: ['Иванов'] }])
    expect(vis).toEqual([0, 2, 4, 5])
  })

  it('пустая ячейка фильтруется как «(пустые)» — значение «»', () => {
    const vis = visibleRowsOf(demoSheet(), [{ col: 0, mode: 'include', values: [''] }])
    expect(vis).toEqual([4])
  })

  it('индекс/видимость: бинарный поиск и ближайшая видимая', () => {
    const vis = [1, 3, 5, 7]
    expect(visibleIndexOf(vis, 3)).toBe(1)
    expect(visibleIndexOf(vis, 4)).toBe(-1)
    expect(visibleIndexOf(vis, 9)).toBe(-1)
    expect(nearestVisibleRow(vis, 4, 1)).toBe(5)
    expect(nearestVisibleRow(vis, 4, -1)).toBe(3)
    expect(nearestVisibleRow(vis, 0, -1)).toBe(1) // раньше первой — сама первая
    expect(nearestVisibleRow(vis, 9, 1)).toBe(7) // позже последней — сама последняя
    expect(nearestVisibleRow(null, 42, 1)).toBe(42)
  })
})

describe('filter: значения колонки для меню (Ф3.7)', () => {
  it('различные значения с количеством, числа по-числовому, текст после чисел', () => {
    const counts = columnValueCounts(demoSheet(), 2)
    expect(counts.map((v) => v.value)).toEqual(['4200', '10000', '12500', 'Сумма'])
    expect(counts[1]).toEqual({ value: '10000', count: 3 })
    expect(counts[3]).toEqual({ value: 'Сумма', count: 1 })
  })

  it('пустые считаются и попадают в конец списка', () => {
    const counts = columnValueCounts(demoSheet(), 1)
    expect(counts[counts.length - 1]).toEqual({ value: '', count: 1 })
    // колонка A: пустая ячейка строки 4 — тоже «(пустые)» в конце
    const countsA = columnValueCounts(demoSheet(), 0)
    expect(countsA[countsA.length - 1]).toEqual({ value: '', count: 1 })
  })
})

describe('filter: сравнение сортировки (Ф8)', () => {
  it('числа числово и раньше текста; текст без регистра; пустые всегда в конце', () => {
    expect(compareCellValues('9', '10')).toBeLessThan(0)
    expect(compareCellValues('10', '9')).toBeGreaterThan(0)
    expect(compareCellValues('100', 'Иванов')).toBeLessThan(0)
    expect(compareCellValues('иванов', 'Иванов')).toBe(0)
    expect(compareCellValues('Иванов', 'петров')).toBeLessThan(0)
    expect(compareCellValues('', 'Иванов')).toBeGreaterThan(0)
    expect(compareCellValues('Иванов', '')).toBeLessThan(0)
  })
})
